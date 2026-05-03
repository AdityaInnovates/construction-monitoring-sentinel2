# 🚧 Satellite-Based Construction Monitoring (Sentinel-2 + GEE)

## Overview

This project implements a geospatial analysis pipeline using **Sentinel-2 satellite imagery** in Google Earth Engine to monitor and classify construction activity along a defined corridor.

It leverages multi-temporal imagery and spectral indices to detect changes over time and categorize construction stages at a segment level.

---

## Problem Statement

Monitoring infrastructure development manually is slow, expensive, and not scalable.

This project addresses:

* Detection of construction activity over time
* Identification of development stages
* Segment-wise analysis for localized insights

---

## Approach

### 1. Data Source

* Sentinel-2 Surface Reflectance (`COPERNICUS/S2_SR_HARMONIZED`)
* Multi-temporal windows:

  * Jan 2024 vs Jun 2024
  * Jan 2025 vs Jun 2025

---

### 2. Preprocessing

* Region of interest defined as a **corridor buffer**
* Median compositing to reduce noise
* Clipping to analysis region

---

### 3. Feature Engineering

The following spectral indices are computed:

* **NDVI (Normalized Difference Vegetation Index)**
  → Vegetation health & loss detection

* **NDBI (Normalized Difference Built-up Index)**
  → Built-up area detection

* **BSI (Bare Soil Index)**
  → Soil exposure / disturbance detection

---

### 4. Segmentation

* Corridor divided into **15 segments**
* Each segment analyzed independently
* Enables localized change detection instead of global averaging

---

### 5. Change Detection

Two temporal comparisons:

* **2024 Change:** `NDVI (t2 - t1)`
* **2025 Change:** `NDVI (t4 - t3)`

---

### 6. Classification Logic

#### 2024 (Initial Activity Detection)

* **Under Construction** → NDVI ↓ and BSI ↑
* **Not Started** → Minimal NDVI change
* **Low Confidence** → Ambiguous signals

#### 2025 (Progress Tracking)

* **Completed** → NDVI ↑ and NDBI ↑
* **Still Under Construction** → NDVI ↓ and BSI ↑
* **Stabilizing** → Transition phase

---

## Outputs

* Segment-wise classification (CSV export)
* NDVI difference maps
* Built-up and soil indicators

Exported via:

```javascript
Export.table.toDrive()
```

---

## Tech Stack

* **Platform:** Google Earth Engine
* **Dataset:** Sentinel-2 (ESA)
* **Language:** JavaScript (GEE)

---

## Repository Structure

```
.
├── scripts/
│   └── construction_analysis.js
├── outputs/
│   └── sample_results.csv
├── assets/
│   └── maps/
├── README.md
```

---

## Key Insights

* NDVI alone is insufficient → combining indices improves accuracy
* Segment-based analysis avoids loss of spatial detail
* Temporal comparison enables tracking progression, not just detection

---

## Limitations

* Threshold-based classification (not ML-based)
* Cloud filtering not fully optimized
* Fixed segmentation (not adaptive to geometry)

---

## Future Improvements

* Integrate ML models for classification
* Dynamic segmentation based on road geometry
* Cloud masking optimization
* Web dashboard for visualization

---

## How to Run

1. Open Google Earth Engine Code Editor
2. Paste the script into a new file
3. Define/import your corridor geometry
4. Run the script
5. Export results to Google Drive

---

## Author

**Aditya Kumar**
Full Stack Developer | AI & Geospatial Enthusiast
