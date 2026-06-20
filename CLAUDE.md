# Bengaluru Traffic Congestion Forecasting System - Data Layer Documentation

## Problem Statement & Solution Overview

### The Problem
Bengaluru faces severe traffic congestion driven by unpredictable incidents (accidents, breakdowns, events) that cascade into city-wide delays. Manual incident response relies on experience-based decision-making without real-time predictive insights, resulting in suboptimal resource deployment and extended clearance times. Officers lack actionable intelligence about:
- **When**: Duration and severity of traffic impact
- **Where**: Geographic scope and affected corridors
- **What**: Resource deployment requirements (personnel, barricades)
- **How**: Optimal positioning of control points and diversion routes

### The Solution
This MVP builds an **event-driven traffic forecasting & resource optimization system** that:

1. **Predicts incident impact** using machine learning models trained on historical Astram data
   - Severity classification (HIGH/LOW) via ensemble classifiers
   - Duration estimation using quantile regression (Q25, Q50, Q75) with survival analysis adjustment
   - Risk scoring from corridor-hour density heatmaps

2. **Generates deployment plans** that automatically:
   - Identify optimal control points around incidents (using OSM road graph + geospatial analysis)
   - Calculate personnel/barricade requirements based on predicted severity
   - Allocate resources from nearest police stations using optimization solvers (OR-Tools)
   - Compute diversion routes to minimize downstream congestion

3. **Captures feedback** from field officers to continuously improve predictions
   - Records actual durations vs. predictions
   - Tracks personnel adjustments and officer ratings
   - Enables model retraining and drift detection

4. **Enables multi-incident coordination** where multiple concurrent incidents are managed holistically

---

## Architecture Overview

### Tech Stack
- **Python 3.11** with SQLAlchemy ORM for database abstraction
- **PostgreSQL 15** with PostGIS extension for geospatial queries
- **FastAPI** REST API (v0.4.0) with WebSocket support for live updates
- **ML Models**: XGBoost & LightGBM for severity/duration prediction
- **Optimization**: Google OR-Tools CBC solver for resource allocation
- **Data Processing**: Pandas, NetworkX, OSMNX for spatial analysis

### Data Flow

```
CSV Events (Astram) 
    ↓
[load_data.py] → Normalize, deduplicate, infer zones, compute durations
    ↓
PostgreSQL (events, police_stations tables)
    ↓
API Requests (events/{event_id}/forecast)
    ↓
[predict.py] → Load ML artifacts, build feature frames, predict impact
    ↓
[generate_plan.py] → Load road graph, find control points, size resources
    ↓
[allocation.py] → Solve resource allocation (personnel, barricades)
    ↓
Deployment Plan (JSON)
    ↓
[workflow.py] → Record plan with approval workflow
    ↓
[Field officers provide feedback via POST /events/{event_id}/feedback]
    ↓
feedback_log.jsonl (or feedback table if DB connected)
```

---

## Core Modules

### 1. **schema.sql** - Database Schema
**Purpose**: Defines the multi-tenant data model for persistent storage.

**Key Tables**:
- **events**: Core incident records with geospatial geometry
  - Generated column `geom`: PostGIS point geometry from lat/lon
  - Indexes on zone, police_station, start_datetime for query performance
  - Supports planned (scheduled_start) and active (start_datetime) events
  
- **police_stations**: Resource inventory per station
  - Tracks available_personnel and available_barricades
  - Zone mapping for allocation proximity constraints
  
- **feedback**: Officer feedback tied to events and plans
  - Stores predicted vs. actual durations
  - Tracks personnel adjustments and officer ratings (1-5)
  - References the generated plan_json for traceability
  
- **plan_workflows**: Audit trail of plan lifecycle
  - Version history with approval_chain (JSON)
  - Tracks: submitted → approved → activated → closed
  
- **audit_log**: Compliance/security log
  - Records every action (plan.created, plan.approved, feedback.recorded)
  - Immutable per-tenant audit trail
  
- **field_status_updates**: Real-time field officer updates
  - Links to control points by node_id
  - Captures status, location, photo_url, notes

**Why**: Multi-tenancy support (tenant_id everywhere) enables the same code to serve multiple cities. PostGIS geospatial types enable proximity queries and coverage analysis.

---

### 2. **load_data.py** - CSV Data Ingestion & Normalization
**Purpose**: Bulk load historical Astram CSV events into PostgreSQL, normalize data quality, auto-seed police stations.

**Key Functions**:

- **load_csv()**: Parse CSV, apply type coercion, deduplicate
  - Normalizes NULL sentinel values ("null", "none", "n/a", etc.)
  - Drops rows with missing id or negative duration
  - Infers zone from lat/lon if missing using hardcoded boundaries
  - Computes duration_minutes from (closed_datetime - start_datetime)

- **infer_zone()**: Deterministic lat/lon → zone mapping
  - Uses simple inequalities to partition Bengaluru into 8 zones
  - Falls back to zone from data if available
  - Why: Enables zone-aware resource allocation even with sparse zone labels

- **reseed_police_stations()**: Auto-generate station seed data
  - Extracts top 15 station names from data
  - Computes station centroid from events (median lat/lon)
  - Deterministically seeds personnel/barricade counts via SHA256 hash
  - Why: Avoids manual data entry; provides plausible baseline if schema not pre-populated

- **upsert_events()**: Batch insert with ON CONFLICT
  - Uses psycopg2 execute_values() for high-throughput ingestion
  - Replaces existing records by id (upsert semantics)
  - Why: Supports re-running without truncation; idempotent

**Why This Module**: Bridges CSV (Astram export) → PostgreSQL. Handles the 80/20 of data quality issues (nulls, duplicates, missing geometry). Enables rapid iteration without manual schema population.

---

### 3. **env_loader.py** - Configuration Management
**Purpose**: Load environment variables from .env-like files.

**Why**: Enables local dev without exposing DATABASE_URL, MODEL_DIR, etc. in code. Supports multiple environments (local, staging, prod).

---

### 4. **predict.py** - ML Impact Forecasting
**Purpose**: Core prediction engine. Takes event features → returns severity, duration, risk, operational metrics.

**Key Functions**:

- **build_feature_frame()**: Convert event dict → pandas DataFrame for model inference
  - Extracts categorical features (event_cause, corridor, zone, police_station, veh_type, etc.)
  - Computes hour_of_day, day_of_week from start_datetime
  - Normalizes category values via feature_cleaning.py
  - Why: ML models expect consistent feature names/types; this ensures them

- **load_artifacts()**: Load pre-trained model pickles & risk density parquet
  - Severity model: classification pipeline (predict probability of HIGH severity)
  - Duration models: quantile regressors (predict Q25, Q50, Q75 duration)
  - Risk density: corridor × hour × day_of_week → risk_score lookup table
  - Survival table: censoring adjustments for right-censored durations
  - Raises FileNotFoundError if models missing (signals need to run train_models.py)

- **risk_score_for_event()**: Lookup historical density for event's corridor/hour/day
  - Exact match → exact risk (corridor + hour_bucket + day_of_week)
  - Fallback 1: Average across all hours for that corridor
  - Fallback 2: Global average risk
  - Returns [0, 1] clamped score
  - Why: Captures seasonal/temporal patterns without retraining

- **survival_context_for_event()**: Adjust duration for censored (incomplete) historical events
  - If history doesn't have event's exact corridor+cause+hour+day, falls back to broader match
  - Computes adjustment_factor = 1 + censoring_rate × {0.35, 0.25, 0.0}
  - Why: Right-censored data (events still ongoing at cutoff) biases Q50/Q75 low; this corrects

- **operational_metrics()**: Compute downstream impact given predictions
  - **expected_delay_minutes**: duration × (risk_score + speed_ratio + rainfall factor)
  - **queue_length_m**: vehicle_count × (1 - speed_ratio) × 4.8m per vehicle
  - **personnel_demand**: 4 + severity_probability×8 + risk_score×6 (capped by event type)
  - **confidence_level**: 1 - (duration_range / max_duration) × 0.45 - (no_GPS_sample×0.12)
  - Integrates live operational context: GPS speeds, CCTV vehicle counts, weather, public advisories
  - Why: Converts point estimates into actionable metrics for deployment planning

- **predict_impact()**: Main entry point
  - Builds feature frame from event
  - Predicts severity probability; thresholds to HIGH/LOW
  - Predicts Q25/Q50/Q75 durations, clamps to event-type-specific cap
  - Applies survival adjustment factor
  - Returns: {severity_label, duration_confidence_interval, risk_score, personnel_demand, ...}

**Why This Module**: Encapsulates ML model logic. Remains agnostic to deployment context (is it a forecast or a plan?). Supports fallback strategies when exact data unavailable. Caching in main.py avoids re-running for the same event.

---

### 5. **generate_plan.py** - Deployment Plan Generation
**Purpose**: Given event features + predictions, generate a complete, executable deployment plan.

**Key Functions**:

- **event_lat_lon()**: Extract lat/lon from event; raise if missing
  - Why: Early validation; deployment requires geography

- **prediction_context()**: Ensure event has severity/duration/risk_score fields
  - If missing, calls predict.py internally
  - Why: Simplifies API; plan generation always has predictions available

- **generate_deployment_plan()**: Main orchestrator
  1. **Get road graph**: Fetch OSM road network for area (or use cached demo graph)
  2. **Find control points**: Identify ~3-5 optimal locations around incident
     - Uses find_control_points() with search_radius_m (800m for LOW, 1200m for HIGH severity)
     - Radius is dynamically sized via control_point_limit_for_event()
  3. **Size resources**: Calculate personnel/barricade count per control point
     - Uses size_event_resources() → applies event-type and severity logic
  4. **Allocate from stations**: Solve optimization problem
     - allocation.py::allocate_personnel() → uses OR-Tools or greedy fallback
     - allocation.py::allocate_barricades() → similar but simpler greedy
     - Prefers nearest stations within 6km radius
  5. **Compute diversions**: Alternative routes to shift traffic
     - Uses diversion.py logic
  6. **Collect warnings**: Flags issues (no control points, barricade shortfall, etc.)

  Returns: {control_points, allocations, diversions, personnel_shortfall, barricade_shortfall, runtime_seconds, ...}

**Why This Module**: Orchestrates end-to-end plan generation. Handles spatial reasoning (road graphs, distance calculations), optimization, and diversion routing. Separates concerns: predict.py (ML), generate_plan.py (geography + optimization), allocation.py (resource matching).

---

### 6. **allocation.py** - Resource Allocation Optimization
**Purpose**: Given control points + available police stations, solve for optimal personnel/barricade assignments.

**Key Functions**:

- **load_police_stations()**: Query PostgreSQL (or fallback to hardcoded FALLBACK_STATIONS)
  - Filters stations with available_personnel > 0
  - Why: Graceful degradation if DB unavailable

- **candidate_station_pairs()**: Build distance matrix
  - For each control point, find nearest 5 stations within max_radius_m
  - Stores (station_index, point_index) → distance_m
  - Why: Reduces solver search space; pre-prunes impossible pairs

- **allocate_personnel()**: Solve assignment problem
  - **Primary**: Spawn child process, load ortools CBC solver, solve LP:
    - Minimize: Σ(distance_m × personnel_assigned) + shortfall_penalty×shortfall
    - Subject to: Σ(personnel_assigned to point i) + shortfall ≤ personnel_needed
                  Σ(personnel_assigned from station j) ≤ available_personnel
  - **Fallback 1**: If subprocess fails, use _greedy_allocate()
    - Iterate through control points; for each, greedily pick nearest station with capacity
  - **Fallback 2**: If ortools ImportError, use greedy
  - Why: OR-Tools gives optimal solution; greedy is fast and acceptable if solver unavailable

- **allocate_barricades()**: Similar to personnel but always uses greedy
  - Barricades are interchangeable; no need for complex optimization
  - Simply assigns nearest-first until exhausted

**Why This Module**: Solves the "who goes where" problem. Multi-fallback strategy ensures a plan is always generated, even if optimization libraries unavailable. Subprocess isolation prevents solver crashes from killing main API.

---

### 7. **control_points.py** - Geographic Control Point Discovery
**Purpose**: Given incident location + road graph, find optimal positions to deploy personnel.

**Key Functions**:
- **find_control_points()**: Use graph topology to identify key intersections/segments
  - Searches radius_m around event (default 800–1200m depending on severity)
  - Prefers arterial roads (higher lane count = wider impact area)
  - Returns sorted by distance + lane estimate
  - Limit parameter caps results (avoid over-allocation)

**Why**: Placement matters. A officer on a clogged arterial affects 10x more vehicles than on a side street. Automated discovery avoids manual configuration.

---

### 8. **geo_utils.py** - Geospatial Utilities
**Purpose**: Distance, coordinate, and routing helpers.

**Key Functions**:
- **haversine_meters()**: Compute great-circle distance between lat/lon pairs
- **nearest_node_by_haversine()**: Find closest OSM node to a point
- **node_lat_lon()**: Extract coordinates from OSM node

**Why**: Decouples geospatial math from business logic. Reusable across modules.

---

### 9. **road_graph.py** - OpenStreetMap Road Network
**Purpose**: Lazy-load and cache OSM road graphs for spatial queries.

**Key Functions**:
- **get_graph_for_point()**: Download OSM graph centered on lat/lon
  - Uses osmnx to fetch graph; caches locally
  - Supports demo mode with tiny offline graph (for CI/testing)
  
- **cache_demo_graph()**: Prepare tiny reproducible graph for testing
  - Enables deterministic tests without network calls

**Why**: OSM provides free, global road data. Caching avoids repeated downloads. Demo graph enables CI without external API calls.

---

### 10. **resource_sizing.py** - Dynamic Resource Calculation
**Purpose**: Convert prediction severity → control point resource needs (personnel, barricades).

**Key Functions**:
- **size_event_resources()**: Apply business logic
  - HIGH severity → more control points + more personnel per point
  - Event type modifiers (crash → higher, breakdown → lower)
  - Returns {control_points: [...], total_personnel, total_barricades}

**Why**: Encodes domain knowledge. Prevents hard-coding resource counts in generate_plan.py.

---

### 11. **diversion.py** - Alternative Route Computation
**Purpose**: Calculate diversions to mitigate downstream congestion.

**Key Functions**:
- **compute_diversions()**: Given incident location + severity, suggest alternative routes
  - Uses road graph + demand model
  - Ranks routes by diversion efficiency

**Why**: Enables proactive traffic management. Officers can push traffic onto pre-planned diversions.

---

### 12. **main.py** - FastAPI REST API
**Purpose**: Exposes forecasting, planning, and feedback workflows via HTTP.

**Architecture Highlights**:

- **Multi-tenancy**: X-Tenant-Id, X-User-Id, X-User-Role headers
  - request_context() dependency extracts context
  - require_roles(*allowed_roles) enforces RBAC

- **Dual-source events**: Queries prioritize PostgreSQL, then fallback to integrations (live feeds, planned permits), then seed data
  - lookup_db_event() → lookup_integrated_event() → lookup_seed_event()
  - Why: Seamless blending of live + historical + test data

- **Caching**: In-memory event signature caching
  - _FORECAST_CACHE, _PLAN_CACHE keyed by (event_id, status, cause, corridor, ...)
  - TTL: 300s forecasts, 600s plans (configurable via env vars)
  - Why: Avoid re-running expensive ML/optimization for rapidly-polled events

- **Event Resolution**: similar_events(event_features, limit=5)
  - Finds historical events with matching cause + corridor + hour-of-day
  - Scores mismatches (cause mismatch=3pts, corridor=2pts, hour distance=0.5-2pts)
  - Why: Context for officers; "here's what happened last time"

- **Feedback Recording**: write_feedback()
  - Stores to PostgreSQL (with schema auto-migrations) or local JSONL
  - Captures actual_duration, officer_rating, adjusted_personnel
  - Audit logs all feedback
  - Why: Feedback closes the loop; enables retraining

- **WebSocket**: /ws/live
  - Broadcasts metrics_summary() + newly_active_events every 5s
  - Why: Real-time dashboard updates

- **Key Endpoints**:
  - POST /events/{event_id}/forecast → predict_impact()
  - POST /events/{event_id}/plan → generate_deployment_plan()
  - POST /events/{event_id}/feedback → write_feedback()
  - POST /workflow/plans → create_plan_record()
  - POST /workflow/plans/{plan_id}/approval → update_plan_approval()
  - GET /metrics/summary, /metrics/roi, /metrics/operational
  - GET /field/assignments, POST /field/status

**Why**: RESTful API is the contract between forecasting logic and frontends (mobile, web, command center).

---

### 13. **workflow.py** - Plan Lifecycle Management
**Purpose**: Manage plan versioning, approval chain, and audit trail.

**Key Functions**:

- **create_plan_record()**: Initiate a plan with approval workflow
  - Generates plan_id (UUID)
  - Sets approval_chain: [traffic_commander (pending), zone_superintendent (pending)]
  - Writes to plan_workflows.jsonl (or PostgreSQL if available)
  - Audit logs: "plan.created"

- **update_plan_approval()**: State transition (submit → approved → activated → closed)
  - Increments version on each transition
  - Updates approval_chain (marks step as approved, moves to next)
  - Audit logs: "plan.{status}"
  - Why: Prevents unauthorized deployment; documents who approved what

- **plan_history()**: Retrieve version history for a plan_id
  - Useful for forensics: "show me all changes to plan X"

- **audit_log()**: Record all sensitive actions
  - Append-only JSONL for audit compliance
  - Why: Non-repudiation; proves who did what when

**Why This Module**: Decouples plan logic from API. Enables offline testing (JSONL backend) and easy migration to PostgreSQL (schema.sql already has tables).

---

### 14. **feature_cleaning.py** - ML Feature Normalization
**Purpose**: Canonicalize categorical feature values.

**Key Functions**:
- **normalize_event_cause()**: "Accident" → "accident"; "VEH_BREAKDOWN" → "breakdown"
- **normalize_category()**: Strip whitespace, lowercase
- **event_category_for_cause()**: Map cause → coarser category (crash, breakdown, congestion)
- **is_minor_road_defect_context()**: Detect potholes/debris; apply lower personnel caps
- **duration_cap_for_event()**: Event-type-specific duration ceiling

**Why**: ML models are brittle to feature variation. Centralized cleaning ensures consistency.

---

### 15. **integrations.py** - Live Data Sources
**Purpose**: Adapter layer for real-time feeds (Google Maps, weather, CCTV, public advisories).

**Key Functions**:
- **live_incidents()**: Fetch active incidents from external API
- **planned_permits()**: Fetch upcoming planned events
- **integration_status()**: Health check on data sources
- **operational_context_for_event()**: Augment event with live context (speeds, rainfall, vehicle count)
- **all_feed_records()**: Snapshot of all feeds

**Why**: Enables fusion of multiple data sources. Graceful degradation if a feed is unavailable (API still returns cached/historical context).

---

### 16. **train_models.py** - ML Model Training Pipeline
**Purpose**: Retrain severity/duration models on feedback data.

(Not detailed here, but part of the full system. Runs offline to generate artifacts for predict.py.)

---

### 17. **model_monitoring.py** - Model Drift Detection
**Purpose**: Detect when predictions diverge from actuals (drift); recommend retraining.

**Key Functions**:
- **drift_summary()**: Compare predicted vs. actual durations; flag if error > threshold
- **forecast_backtest_summary()**: Hind-sight evaluation on historical feedback
- **retrain_plan()**: Recommend retraining if drift detected

**Why**: Prevents silent model decay. Alerts ops to stale models.

---

### 18. **multi_incident.py** - Multi-Incident Coordination
**Purpose**: Generate holistic plans for multiple concurrent incidents.

**Key Function**:
- **build_multi_incident_plan()**: Solve for all control points + allocations across all incidents simultaneously
  - Uses constrained optimization
  - Why: Avoids resource over-allocation; e.g., two incidents 2km apart don't both pull from the same police station

---

### 19. **seed_feedback.py** - Test Data Generation
**Purpose**: Generate synthetic feedback records for testing/development.

**Why**: Enables development without live officer input. Populates feedback logs for model training.

---

### 20. **platform_ops.py** - Operational Health & Compliance
**Purpose**: System health, retention policies, security controls.

**Key Functions**:
- **platform_health()**: Uptime, DB connectivity, integration count
- **retention_policy()**: Data retention rules (e.g., delete feedback > 90 days)
- **security_controls()**: RBAC matrix

**Why**: Ensures compliance, observability, and graceful degradation.

---

### Supporting Modules

- **model_monitoring.py**: Drift detection, backtest summaries
- **operational_monitoring.py**: Real-time queue length, delay estimates
- **roi_metrics.py**: Executive summaries (cost savings, response time improvements)
- **benchmark_system.py**: Performance profiling

---

## Data Flow Examples

### Example 1: Forecast a Crash on MG Road

```python
POST /events/crash-001/forecast

{
  "event_id": "crash-001",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "event_cause": "Accident",
  "corridor": "M G Road",
  "zone": "Central Zone 1",
  "police_station": "Cubbon Park",
  "start_datetime": "2026-06-20T09:30:00+05:30"
}

# predict.py:
# 1. Build feature frame: {event_cause, corridor, zone, police_station, hour_of_day=9, day_of_week=2}
# 2. Predict severity: P(HIGH) = 0.72 → severity_label = "HIGH"
# 3. Predict durations: Q25=15, Q50=28, Q75=45 (with survival adjustment)
# 4. Lookup risk_score: corridor="M G Road" + hour=9 + day=Tue → 0.65
# 5. Operational metrics: personnel_demand=11, expected_delay=22 min, queue=450m
#
# Response:
{
  "severity_label": "HIGH",
  "severity_probability": 0.72,
  "duration_median": 28,
  "duration_confidence_interval": { "low": 15, "median": 28, "high": 45 },
  "risk_score": 0.65,
  "personnel_demand": 11,
  "expected_delay_minutes": 22,
  "queue_length_m": 450,
  "confidence_level": 0.78,
  "operational_context": {
    "speed": { "speed_ratio": 0.45, "delay_factor": 0.35, ... },
    "sensors": { "vehicle_count_15m": 240, ... },
    "weather": { "rainfall_mm_1h": 2.5, ... }
  }
}
```

### Example 2: Generate Deployment Plan

```python
POST /events/crash-001/plan

# Uses forecast data + generates plan:
# 1. Load OSM graph for lat=12.9716, lon=77.5946
# 2. Find control points: 1200m radius (HIGH severity)
# 3. Identify 3-4 intersections on MG Road + side streets
# 4. Size resources: 11 personnel, 8 barricades
# 5. Load police stations: Cubbon Park (21 avail), High Ground (18 avail), etc.
# 6. Solve allocation: Station A → 5 personnel to CP1, Station B → 4 personnel to CP2, etc.
# 7. Compute diversions: Route traffic via Residency Road, Brigade Road
#
# Response:
{
  "control_points": [
    { "node_id": 12345, "lat": 12.9720, "lon": 77.5950, "lane_estimate": 4, 
      "personnel_needed": 5, "barricades_needed": 3 },
    { "node_id": 12346, "lat": 12.9710, "lon": 77.5935, "lane_estimate": 3,
      "personnel_needed": 4, "barricades_needed": 3 }
  ],
  "allocations": [
    { "control_point_node_id": 12345, "station_name": "Cubbon Park", 
      "personnel_assigned": 5, "distance_m": 280 },
    { "control_point_node_id": 12346, "station_name": "High Ground", 
      "personnel_assigned": 4, "distance_m": 420 }
  ],
  "total_personnel": 9,
  "personnel_shortfall": 2,  # wanted 11, got 9
  "diversions": [ "Residency Rd", "Brigade Rd" ],
  "plan_warnings": ["Personnel shortfall: 2 units"]
}
```

### Example 3: Record Officer Feedback

```python
POST /events/crash-001/feedback

{
  "accepted": true,
  "actual_duration_minutes": 26,  # plan said 28 → very accurate!
  "officer_rating": 5,
  "adjusted_personnel": 9  # we deployed what was suggested
}

# workflow.py & main.py:
# 1. Get event from DB
# 2. Compute predicted severity (0.72) + duration (28)
# 3. Plan total = 9 personnel (from plan)
# 4. Append feedback record with plan_json snapshot
# 5. Audit log: action="feedback.recorded", details={accepted, rating, adjusted}
#
# Response:
{
  "event_id": "crash-001",
  "accepted": true,
  "predicted_duration_minutes": 28,
  "plan_total_personnel": 9,
  "stored": true
}

# Stored in feedback table (or feedback_log.jsonl):
{
  "event_id": "crash-001",
  "predicted_severity": "HIGH",
  "predicted_duration_minutes": 28,
  "actual_duration_minutes": 26,  # error = 2/26 = 7.7%
  "officer_rating": 5,
  "plan_accepted": true,
  "plan_total_personnel": 9,
  "created_at": "2026-06-20T10:05:00Z"
}
```

---

## Key Design Decisions

### Why PostgreSQL + PostGIS?
- **Geospatial queries**: `ST_DWithin(geom, point, 1000)` finds all incidents within 1km
- **Multi-tenancy**: Tenant isolation via schema or simple tenant_id filter
- **ACID guarantees**: Feedback + plan transitions are atomic

### Why Caching in main.py?
- **Reduces latency**: Forecast cache hit (300ms) vs. full ML run (2s)
- **Signature-based**: Cache invalidates if event properties change (status, cause, priority)
- **Simple TTL**: No cache invalidation complexity; stale data expires naturally

### Why Fallback Strategies?
- **Graceful degradation**: If DB unavailable, use JSONL + hardcoded stations
- **If road graph unavailable**: Use demo graph or return plan with warnings
- **If OR-Tools unavailable**: Use greedy allocation (suboptimal but acceptable)
- **Why**: Ensures system stays alive even if components fail

### Why Separate Modules (predict.py vs. generate_plan.py)?
- **Testability**: Can test prediction without touching geography
- **Reusability**: Forecast can be called standalone; not coupled to deployment
- **Separation of concerns**: ML logic ≠ spatial logic ≠ API logic

### Why Workflow + Audit Log?
- **Non-repudiation**: "Who approved this plan?" is auditable
- **Version history**: Rollback capability; forensics
- **Compliance**: Satisfies governance requirements

---

## Testing & Local Development

### Setup
```bash
# Install deps
pip install -r requirements.txt

# Create local DB (if Postgres available)
export DATABASE_URL="postgresql+psycopg2://user:pass@localhost/gridlock"
python load_data.py events.csv

# Or run offline (fallback to JSONL + hardcoded stations)
# (DATABASE_URL undefined; system uses local_feedback_rows())
```

### Testing Predictions
```bash
python predict.py
# Prints sample forecast for Outer Ring Road accident

python generate_plan.py --lat 12.9716 --lon 77.5946 --demo-cache
# Generates plan using tiny cached road graph (no network calls)
```

### Running API
```bash
uvicorn main:app --reload --port 8000
# Visit http://localhost:8000/docs for interactive API explorer
```

---

## Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| forecast_event (cache hit) | ~50ms | Just a dict lookup |
| forecast_event (cache miss) | ~2000ms | ML inference |
| generate_deployment_plan | ~500ms | Road graph fetch cached; allocation is fast |
| allocate_personnel (with OR-Tools) | ~100ms | Depends on station count |
| write_feedback | ~50ms | JSONL append or DB insert |
| /ws/live broadcast | ~100ms | Every 5s to all connected clients |

---

## Limitations & Future Work

1. **No re-routing in transit**: System generates diversions at incident time; doesn't adapt as incident evolves
2. **No multi-vehicle incidents**: Can't represent crash involving multiple vehicles separately
3. **No weather-aware routing**: Diversions don't account for rain-induced slowdowns
4. **No congestion-aware predictions**: Doesn't account for upstream incidents affecting baseline speeds
5. **Limited to Bengaluru**: Zone boundaries, police stations hardcoded; would need parameterization for other cities

---

## Glossary

- **Control Point**: Intersection or segment where officers are stationed to manage traffic flow
- **Road Graph**: OpenStreetMap representation of road network (nodes=intersections, edges=segments)
- **Survivor Adjustment**: Correction factor for right-censored historical durations (events incomplete at data cutoff)
- **Risk Density**: Heatmap of corridor × hour × day_of_week → incident probability
- **Allocation Shortfall**: Number of personnel/barricades needed but unavailable within allocation radius
- **Drift**: Divergence between predicted and actual outcomes over time
- **Plan Workflow**: State machine: draft → submitted → approved → activated → closed
- **Feedback Loop**: Officer actual outcomes → stored in feedback table → used for model retraining

---

## References

- **Astram**: Bengaluru traffic incident reporting system (data source)
- **OR-Tools**: Google's optimization solver (allocation)
- **OSMNX**: Python wrapper for OpenStreetMap (road graph)
- **PostGIS**: PostgreSQL spatial extension
- **LightGBM**: Fast gradient boosting for quantile regression
- **Scikit-Learn**: ML pipeline & preprocessing