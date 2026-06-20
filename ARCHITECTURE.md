# TrafficGuide Architecture Documentation

## 🎯 Project Overview

**TrafficGuide** is an event-driven traffic congestion forecasting and resource optimization system designed for Bengaluru's traffic management. This MVP focuses on the **data layer and prediction/planning pipeline**, enabling rapid incident response with data-driven resource deployment.

### Key Capabilities

1. **Real-time Impact Prediction**: ML models predict incident severity and duration within seconds
2. **Intelligent Deployment Planning**: Automatically identifies optimal control points and allocates personnel/barricades
3. **Multi-Incident Coordination**: Manages multiple concurrent incidents holistically
4. **Feedback Loop**: Officers report outcomes → system learns and improves
5. **Multi-tenancy Ready**: Same codebase can serve multiple cities
6. **Graceful Degradation**: System remains operational even if components fail

---

## 👥 Team

| Member | Role | Responsibility |
|--------|------|-----------------|
| **Yash Sonalekar** | Lead Developer | Backend architecture, ML integration, API design |
| **Nishant Gawande** | Full-Stack Engineer | Database optimization, data pipeline |
| **Ayush Shevde** | Data/ML Engineer | ML model development, feature engineering |

---

## 🔗 Live Links

| Resource | Link | Status |
|----------|------|--------|
| **API Server** | `http://localhost:8000` | 🚀 Development |
| **API Documentation (Swagger)** | `http://localhost:8000/docs` | 📚 Available |
| **Alternative Docs (ReDoc)** | `http://localhost:8000/redoc` | 📚 Available |
| **WebSocket Live Feed** | `ws://localhost:8000/ws/live` | 📡 Real-time |
| **GitHub Repository** | [TrafficGuide](https://github.com) | 🔗 Main Branch |

> **Note**: Update these links based on your actual deployment environment (staging/production)

---

## 🏗️ System Architecture

```mermaid
graph TB
    subgraph DataSources["📥 DATA SOURCES"]
        CSV["CSV Files<br/>(Astram Exports)"]
        LiveFeeds["Live Feeds<br/>(Google Maps, CCTV)"]
        PlannedEvents["Planned Events<br/>(Permits, VIP)"]
        Weather["Weather API<br/>(Rainfall, Temp)"]
    end

    subgraph DataLayer["💾 DATA LAYER"]
        PostgreSQL["PostgreSQL 15<br/>+ PostGIS"]
        JSONL["JSONL Files<br/>(Offline Fallback)"]
        Cache["In-Memory Cache<br/>(Forecast, Plans)"]
    end

    subgraph FeatureEng["🔧 FEATURE ENGINEERING"]
        FeatureCleaning["feature_cleaning.py<br/>━━━━━━━━<br/>Normalize categories<br/>Handle edge cases"]
        Integration["integrations.py<br/>━━━━━━━━<br/>Enrich event context<br/>Operational metrics"]
    end

    subgraph MLLayer["🤖 ML FORECASTING"]
        PredictPy["predict.py<br/>━━━━━━━━<br/>Severity Classification<br/>Duration Quantiles<br/>Risk Scoring"]
        SeverityModel["XGBoost<br/>Classifier"]
        DurationModels["LightGBM<br/>Quantile Regressors"]
        RiskDensity["Risk Density<br/>Heatmap"]
    end

    subgraph PlanningLayer["🗺️ SPATIAL PLANNING"]
        RoadGraph["road_graph.py<br/>━━━━━━━━<br/>OSM Network<br/>(Cached)"]
        ControlPoints["control_points.py<br/>━━━━━━━━<br/>Find optimal<br/>deployment locations"]
        GenPlan["generate_plan.py<br/>━━━━━━━━<br/>Orchestrate plan<br/>generation"]
    end

    subgraph AllocationLayer["⚙️ OPTIMIZATION"]
        ResourceSizing["resource_sizing.py<br/>━━━━━━━━<br/>Personnel/Barricade<br/>requirements"]
        AllocPy["allocation.py<br/>━━━━━━━━<br/>OR-Tools Solver<br/>+ Greedy Fallback"]
        Diversion["diversion.py<br/>━━━━━━━━<br/>Alternative routes<br/>Congestion mitigation"]
    end

    subgraph WorkflowLayer["📋 WORKFLOW & AUDIT"]
        Workflow["workflow.py<br/>━━━━━━━━<br/>Plan Lifecycle<br/>Approval Chain<br/>Audit Log"]
    end

    subgraph FeedbackLoop["📊 FEEDBACK & LEARNING"]
        FeedbackCapture["Officer Feedback<br/>━━━━━━━━<br/>Duration, Rating<br/>Plan Adjustments"]
        ModelMonitor["model_monitoring.py<br/>━━━━━━━━<br/>Drift Detection<br/>Backtest Analysis"]
        ModelRetraining["train_models.py<br/>━━━━━━━━<br/>Model Retraining<br/>(Offline)"]
    end

    subgraph Execution["🚀 EXECUTION"]
        API["FastAPI<br/>REST + WebSocket"]
        FieldOfficers["Field Officers<br/>(Mobile)"]
        Dashboard["Command Center<br/>(Web)"]
        WebSocket["Live Updates<br/>(5s broadcast)"]
    end

    %% Data flow connections
    CSV --> DataLayer
    LiveFeeds --> DataLayer
    PlannedEvents --> DataLayer
    Weather --> DataLayer

    DataLayer --> FeatureEng
    FeatureEng --> MLLayer
    MLLayer --> PlanningLayer
    PlanningLayer --> AllocationLayer
    AllocationLayer --> WorkflowLayer
    WorkflowLayer --> Execution

    FieldOfficers --> FeedbackCapture
    Dashboard --> FeedbackCapture
    FeedbackCapture --> ModelMonitor
    ModelMonitor --> ModelRetraining
    ModelRetraining -.->|Updates Models| MLLayer

    API --> FieldOfficers
    API --> Dashboard
    API --> WebSocket

    classDef source fill:#e1f5ff,stroke:#01579b,stroke-width:2px,color:#000
    classDef layer fill:#f3e5f5,stroke:#4a148c,stroke-width:2px,color:#000
    classDef ml fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px,color:#000
    classDef planning fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#000
    classDef exec fill:#e0f2f1,stroke:#004d40,stroke-width:2px,color:#000
    classDef feedback fill:#f1f8e9,stroke:#33691e,stroke-width:2px,color:#000

    class DataSources source
    class DataLayer,FeatureEng layer
    class MLLayer,RiskDensity ml
    class RoadGraph,ControlPoints,GenPlan,ResourceSizing,AllocPy,Diversion planning
    class WorkflowLayer layer
    class Execution exec
    class FeedbackLoop,ModelMonitor,ModelRetraining feedback
```

---

## 💾 Data Architecture

```mermaid
graph LR
    subgraph DataStorage["📦 PERSISTENT STORAGE"]
        DB["PostgreSQL 15 + PostGIS<br/>━━━━━━━━━━━━<br/>tenants<br/>app_users<br/>events (w/ geom)<br/>police_stations<br/>feedback<br/>plan_workflows<br/>field_status_updates<br/>audit_log"]
        
        Fallback["JSONL Files<br/>━━━━━━━━━━━━<br/>feedback_log.jsonl<br/>plan_workflows.jsonl<br/>audit_log.jsonl<br/>(Offline mode)"]
    end

    subgraph AppLayer["🐍 APPLICATION LAYER"]
        ORM["SQLAlchemy<br/>ORM<br/>Type-safe<br/>queries"]
    end

    subgraph APISvr["🌐 API SERVER"]
        FastAPI["FastAPI 0.110+<br/>━━━━━━━━<br/>REST Endpoints<br/>WebSocket<br/>Real-time Updates"]
        
        Memory["In-Memory Cache<br/>━━━━━━━━<br/>Forecast Cache<br/>(300s TTL)<br/>Plan Cache<br/>(600s TTL)"]
    end

    subgraph Clients["👥 CLIENTS"]
        Mobile["Mobile App<br/>(Field Officers)"]
        Web["Web Dashboard<br/>(Command Center)"]
        Integration["Integration<br/>APIs<br/>(External Systems)"]
    end

    %% Data flow
    DB --> ORM
    Fallback --> ORM
    ORM --> FastAPI
    FastAPI --> Memory
    Memory --> FastAPI
    FastAPI --> Mobile
    FastAPI --> Web
    FastAPI --> Integration

    classDef storage fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#000
    classDef app fill:#f3e5f5,stroke:#4a148c,stroke-width:2px,color:#000
    classDef api fill:#fff9c4,stroke:#f57f17,stroke-width:2px,color:#000
    classDef client fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px,color:#000

    class DataStorage,Fallback storage
    class ORM app
    class FastAPI,Memory,APISvr api
    class Mobile,Web,Integration,Clients client
```

**Database Schema Overview**:

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `events` | Core incident records with geospatial geometry | id, latitude, longitude, geom (PostGIS Point), event_cause, corridor, zone, status, duration_minutes |
| `police_stations` | Resource inventory per station | name, zone, latitude, longitude, available_personnel, available_barricades |
| `feedback` | Officer feedback on forecasts and plans | event_id, predicted_severity, actual_duration_minutes, officer_rating, plan_accepted, plan_json |
| `plan_workflows` | Plan lifecycle and approval chain | plan_id, event_id, status, version, approval_chain (JSON), plan_json |
| `audit_log` | Immutable compliance log | audit_id, action, actor, resource_type, resource_id, details (JSON) |
| `field_status_updates` | Real-time field officer status | event_id, control_point_node_id, status, latitude, longitude, photo_url, note |

---

## 🤖 ML Pipeline Architecture

```mermaid
graph LR
    subgraph TrainingPipeline["📊 MODEL TRAINING (Offline)"]
        HistoricalData["Historical Data<br/>━━━━━<br/>Feedback Table<br/>Event History<br/>(30-day window)"]
        
        DataProcessing["Data Processing<br/>━━━━━<br/>Normalize features<br/>Handle censoring<br/>Feature engineering"]
        
        FeatureEngineering["Feature Matrix<br/>━━━━━<br/>hour_of_day<br/>day_of_week<br/>event_cause<br/>corridor<br/>zone<br/>police_station"]
        
        TrainSeverity["Train Severity<br/>Classifier<br/>━━━━━<br/>XGBoost<br/>Pipeline"]
        
        TrainDuration["Train Duration<br/>Regressors<br/>━━━━━<br/>LightGBM<br/>Quantiles:<br/>Q25, Q50, Q75"]
        
        TrainRisk["Compute Risk<br/>Density<br/>━━━━━<br/>Corridor × Hour<br/>× Day_of_Week"]
        
        ArtifactOutput["Output Artifacts<br/>━━━━━━━━<br/>severity_model.pkl<br/>duration_q*.pkl<br/>risk_density.parquet<br/>survival_table.parquet"]
    end

    subgraph InferencePipeline["⚡ INFERENCE (Online)"]
        EventInput["Event Input<br/>━━━━━<br/>Cause, Corridor<br/>Zone, Station<br/>Datetime"]
        
        LoadArtifacts["Load Artifacts<br/>━━━━━<br/>LRU Cache<br/>~100-200MB<br/>loaded once"]
        
        BuildFeatures["Build Features<br/>━━━━━<br/>Normalize categories<br/>Enrich context<br/>Add time features"]
        
        PredictSeverity["Predict Severity<br/>━━━━━<br/>P(HIGH severity)<br/>XGBoost inference<br/>(~100ms)"]
        
        PredictDuration["Predict Duration<br/>━━━━━<br/>Q25, Q50, Q75<br/>LightGBM quantile<br/>regression"]
        
        RiskLookup["Risk Score<br/>Lookup<br/>━━━━━<br/>Exact match or<br/>fallback aggregation"]
        
        SurvivalAdjust["Survival<br/>Adjustment<br/>━━━━━<br/>Correct for<br/>right-censored data"]
        
        OperMetrics["Operational<br/>Metrics<br/>━━━━━<br/>Personnel demand<br/>Expected delay<br/>Queue length<br/>Confidence"]
        
        ForecastOutput["Forecast Output<br/>━━━━━<br/>severity_label<br/>duration_CI<br/>risk_score<br/>personnel_demand"]
    end

    subgraph Monitoring["📈 MONITORING & DRIFT"]
        FeedbackCompare["Compare Predicted<br/>vs Actual<br/>━━━━━<br/>Compute error rates<br/>Aggregate by<br/>corridor/cause"]
        
        DriftDetect["Drift Detection<br/>━━━━━<br/>Error > threshold?<br/>Distribution shift?"]
        
        Retrain["Flag for<br/>Retraining<br/>━━━━━<br/>Alert ops<br/>Schedule retrain"]
    end

    %% Training flow
    HistoricalData --> DataProcessing
    DataProcessing --> FeatureEngineering
    FeatureEngineering --> TrainSeverity
    FeatureEngineering --> TrainDuration
    FeatureEngineering --> TrainRisk
    TrainSeverity --> ArtifactOutput
    TrainDuration --> ArtifactOutput
    TrainRisk --> ArtifactOutput

    %% Inference flow
    EventInput --> LoadArtifacts
    EventInput --> BuildFeatures
    LoadArtifacts --> PredictSeverity
    LoadArtifacts --> PredictDuration
    LoadArtifacts --> RiskLookup
    BuildFeatures --> PredictSeverity
    BuildFeatures --> PredictDuration
    BuildFeatures --> RiskLookup
    PredictSeverity --> SurvivalAdjust
    PredictDuration --> SurvivalAdjust
    RiskLookup --> SurvivalAdjust
    SurvivalAdjust --> OperMetrics
    OperMetrics --> ForecastOutput

    %% Monitoring flow
    ForecastOutput --> FeedbackCompare
    FeedbackCompare --> DriftDetect
    DriftDetect --> Retrain
    Retrain -.->|Triggers Offline| TrainingPipeline

    %% Styling
    classDef training fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px,color:#000
    classDef inference fill:#b3e5fc,stroke:#01579b,stroke-width:2px,color:#000
    classDef monitoring fill:#ffe0b2,stroke:#e65100,stroke-width:2px,color:#000

    class TrainingPipeline,HistoricalData,DataProcessing,FeatureEngineering,TrainSeverity,TrainDuration,TrainRisk,ArtifactOutput training
    class InferencePipeline,EventInput,LoadArtifacts,BuildFeatures,PredictSeverity,PredictDuration,RiskLookup,SurvivalAdjust,OperMetrics,ForecastOutput inference
    class Monitoring,FeedbackCompare,DriftDetect,Retrain monitoring
```

**Model Artifacts**:

| Artifact | Type | Purpose | Size |
|----------|------|---------|------|
| `severity_model.pkl` | XGBoost Pipeline | Classify incidents as HIGH/LOW severity | ~10MB |
| `duration_q25_model.pkl` | LightGBM Regressor | Predict 25th percentile duration | ~8MB |
| `duration_q50_model.pkl` | LightGBM Regressor | Predict median duration | ~8MB |
| `duration_q75_model.pkl` | LightGBM Regressor | Predict 75th percentile duration | ~8MB |
| `risk_density.parquet` | Parquet DataFrame | Corridor × Hour × Day-of-Week risk heatmap | ~50MB |
| `duration_survival_table.parquet` | Parquet DataFrame | Censoring adjustments per corridor/cause | ~5MB |

---

## 📐 Data Flow: End-to-End Example

```mermaid
sequenceDiagram
    actor Officer as Field Officer/Admin
    participant API as FastAPI API
    participant Cache as Forecast Cache
    participant ML as predict.py
    participant Plan as generate_plan.py
    participant Alloc as allocation.py
    participant Workflow as workflow.py
    participant DB as PostgreSQL

    Officer->>API: POST /events/{event_id}/forecast
    API->>Cache: Check cache (300s TTL)
    alt Cache Hit
        Cache-->>API: Return cached forecast
    else Cache Miss
        API->>ML: predict_impact(event)
        ML->>ML: Load artifacts (LRU)
        ML->>ML: Build features, normalize
        ML->>ML: Predict severity (XGBoost)
        ML->>ML: Predict duration (LightGBM Q25/Q50/Q75)
        ML->>ML: Risk score lookup + survival adjustment
        ML->>ML: Operational metrics
        ML-->>API: Return forecast
        API->>Cache: Store (TTL 300s)
    end
    API-->>Officer: Forecast JSON

    Officer->>API: POST /events/{event_id}/plan
    API->>Cache: Check plan cache (600s TTL)
    alt Cache Hit
        Cache-->>API: Return cached plan
    else Cache Miss
        API->>Plan: generate_deployment_plan(event)
        Plan->>Plan: Load OSM road graph (cached)
        Plan->>Plan: Find control points (1200m radius)
        Plan->>Plan: Size resources (HIGH severity → more personnel)
        Plan->>Alloc: allocate_personnel(control_points, stations)
        Alloc->>Alloc: Build distance matrix
        Alloc->>Alloc: Solve LP (OR-Tools or greedy)
        Alloc-->>Plan: Return allocations + shortfall
        Plan->>Alloc: allocate_barricades(...)
        Plan->>Plan: Compute diversions
        Plan-->>API: Return plan
        API->>Cache: Store (TTL 600s)
    end
    API-->>Officer: Plan JSON

    Officer->>API: POST /workflow/plans
    API->>Workflow: create_plan_record(plan)
    Workflow->>DB: INSERT INTO plan_workflows
    Workflow->>DB: INSERT INTO audit_log
    Workflow-->>API: Return plan_id + approval_chain
    API-->>Officer: Plan created, awaiting approval

    Officer->>API: POST /workflow/plans/{plan_id}/approval
    API->>Workflow: update_plan_approval("submit")
    Workflow->>DB: INSERT INTO plan_workflows (version++)
    Workflow->>DB: INSERT INTO audit_log
    Workflow-->>API: Plan submitted

    Officer->>API: POST /events/{event_id}/feedback
    API->>DB: INSERT INTO feedback
    API->>DB: INSERT INTO audit_log
    API-->>Officer: Feedback recorded
```

---

## 🔄 Feedback Loop & Model Retraining

```mermaid
graph LR
    subgraph OfflineCycle["🔄 OFFLINE CYCLE (24h)")
        Collect["Collect Feedback<br/>━━━━━<br/>Last 30 days<br/>of feedback<br/>records"]
        
        Analyze["Analyze Drift<br/>━━━━━<br/>Compute error<br/>rates by<br/>corridor/cause"]
        
        Decide["Decision<br/>━━━━━<br/>Error > 15%?<br/>Threshold met?"]
        
        Train["Retrain Models<br/>━━━━━<br/>Rerun training<br/>pipeline on<br/>new feedback"]
        
        Validate["Validate<br/>━━━━━<br/>Backtest on<br/>held-out data"]
        
        Deploy["Deploy<br/>Artifacts<br/>━━━━━<br/>Update<br/>models/ dir<br/>Invalidate<br/>artifact cache"]
    end

    Collect --> Analyze
    Analyze --> Decide
    Decide -->|Yes| Train
    Decide -->|No| Collect
    Train --> Validate
    Validate -->|Pass| Deploy
    Validate -->|Fail| Collect

    Deploy -.-> |Next forecast<br/>uses new models| ForecastInference["Next Forecast<br/>Request"]

    classDef feedback fill:#fff9c4,stroke:#f57f17,stroke-width:2px,color:#000
    classDef deploy fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px,color:#000

    class Collect,Analyze,Decide,Train,Validate feedback
    class Deploy,ForecastInference deploy
```

---

## 📸 Screenshots & UI Reference

### API Documentation
```
Visit http://localhost:8000/docs for interactive Swagger UI
Visit http://localhost:8000/redoc for ReDoc alternative
```

**Screenshot Placeholders**:
- [ ] API Swagger interface
- [ ] Forecast response JSON example
- [ ] Plan generation with control points map
- [ ] Approval workflow UI
- [ ] Real-time WebSocket dashboard
- [ ] Field officer mobile interface
- [ ] Command center dashboard
- [ ] Feedback recording form
- [ ] Metrics and ROI dashboard
- [ ] Audit log viewer

> **To add**: Place screenshots in `docs/screenshots/` and reference them here:
> ```
> ![API Docs](./docs/screenshots/api-docs.png)
> ```

---

## 🎯 Key Design Decisions

| Decision | Rationale | Trade-offs |
|----------|-----------|-----------|
| **PostgreSQL + PostGIS** | Geospatial queries, multi-tenancy, ACID guarantees | Requires database setup; JSONL fallback available |
| **In-Memory Caching (300-600s TTL)** | Reduce ML re-runs; fast forecast responses | Stale data up to TTL; no distributed cache |
| **Subprocess for OR-Tools** | Prevent solver crashes from killing API | Overhead of subprocess spawning (~100ms) |
| **Greedy allocation fallback** | Works when OR-Tools unavailable | Suboptimal vs. LP solution |
| **JSONL for offline mode** | Works without database; immutable audit logs | Sequential scan slower than SQL queries |
| **Survival analysis for duration** | Corrects for right-censored historical data | Requires censoring table; adds complexity |

---

## 🚀 Quick Start Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run API server
uvicorn main:app --reload --port 8000

# Test forecast (standalone)
python predict.py

# Test plan generation (demo mode, no network)
python -m backend.optimization.generate_plan --lat 12.9716 --lon 77.5946 --demo-cache

# Load historical data into PostgreSQL
python -m backend.data.load_data path/to/events.csv

# Retrain ML models
python -m backend.ml.train_models

# Run tests
pytest tests/ -v
```

---

## 📞 Support & Contributing

- **Issues**: Report bugs in GitHub issues
- **Discussions**: Ask questions in GitHub discussions
- **PRs**: Submit pull requests for new features
- **Docs**: Update CLAUDE.md for major architectural changes

---

**Last Updated**: June 20, 2026  
**Architecture Version**: 1.0  
**Status**: Production-Ready MVP
