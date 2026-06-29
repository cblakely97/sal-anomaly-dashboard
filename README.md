# SAL Anomaly Dashboard

GitHub Pages dashboard for MPAS-Ocean SAL mass anomaly tidal validation.

## Structure

```
├── index.html          # About page
├── comparison.html     # Interactive station map + time series
├── css/style.css
├── js/comparison.js
└── data/
    ├── stations.json          # Station index with metrics per run
    └── timeseries/<id>.json   # Per-station time series (one file per station)
```

## Data schema

### stations.json

Array of objects:
```json
{
  "station_id": "...",
  "site_name": "...",
  "country": "...",
  "latitude": 0.0,
  "longitude": 0.0,
  "dist_km": 0.0,
  "runs": ["bpanomaly", "atm-tide-only"],
  "metrics": {
    "bpanomaly":     { "rmse_m": 0.0, "correlation": 0.0, "bias_m": 0.0, "n_hours": 0 },
    "atm-tide-only": { "rmse_m": 0.0, "correlation": 0.0, "bias_m": 0.0, "n_hours": 0 }
  }
}
```

### timeseries/<station_id>.json

```json
{
  "station_id": "...",
  "site_name": "...",
  "country": "...",
  "t0": "2017-01-01T00:00:00",
  "dt_hours": 0.1,
  "n": 87660,
  "obs":              [...],
  "obs_ntr":          [...],
  "bpanomaly":        [...],
  "bpanomaly_ntr":    [...],
  "atm-tide-only":    [...],
  "atm-tide-only_ntr":[...],
  "metrics": {
    "bpanomaly":     { "rmse_m": 0.0, "correlation": 0.0, "bias_m": 0.0, "n_hours": 0 },
    "atm-tide-only": { "rmse_m": 0.0, "correlation": 0.0, "bias_m": 0.0, "n_hours": 0 }
  }
}
```

## Adding a new run

1. Add an entry to the `RUNS` array in `js/comparison.js`
2. Add the run's metrics to `stations.json` under each station's `metrics` dict
3. Add `<runkey>` and `<runkey>_ntr` arrays to each timeseries JSON

## Local testing

```bash
cd ~/scratch/libs/sal-anomaly-dashboard
python3 -m http.server 8000
# open http://localhost:8000
```

## Deployment

Push to GitHub, enable Pages on `main` branch from root.
