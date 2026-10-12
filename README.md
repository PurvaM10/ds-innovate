<<<<<<< HEAD
# 📊 Datasets

This project uses two industrial visual-inspection datasets to cover both **surface defects** and **structural/logical anomalies**.

---

## 1. MVTec LOCO AD

**MVTec LOCO AD (Logical Constraints Anomaly Detection)** is an industrial anomaly-detection dataset developed by **MVTec, Germany**.

The dataset was created specifically for evaluating computer-vision systems in **real-world-inspired industrial inspection scenarios**. It contains both **structural anomalies** such as scratches, dents, and contamination, and **logical anomalies** such as missing or incorrectly positioned components.

### Dataset Statistics

| Feature | Details |
|---|---|
| **Source** | MVTec, Germany |
| **Total Images** | 3,644 |
| **Categories** | 5 industrial categories |
| **Training Images** | 1,772 |
| **Validation Images** | 304 |
| **Test Images** | 1,568 |
| **Anomaly Types** | Structural + Logical |
| **Annotations** | Pixel-precise ground truth |

### What it is used for

MVTec LOCO AD is used in this project to detect:

- Scratches and dents
- Surface contamination
- Missing components
- Incorrect component positions
- Incorrect assembly / logical anomalies
- Other deviations from the expected product structure

The dataset contains images of distinct physical objects captured for industrial inspection scenarios, with anomaly-free training/validation images and anomalous test images. :contentReference[oaicite:0]{index=0}

**Official Source:** [MVTec LOCO AD](https://www.mvtec.com/research-teaching/datasets/mvtec-loco-ad)

---

## 2. KolektorSDD2

**KolektorSDD2 (Kolektor Surface-Defect Dataset 2)** is a real-world industrial surface-defect dataset developed by researchers from the **University of Ljubljana, Slovenia**, using production items provided by the industrial partner **Kolektor Group d.o.o.**

The images were captured using a **visual inspection system in a controlled production environment**. The dataset focuses on surface defects occurring on manufactured production items.

### Dataset Statistics

| Feature | Details |
|---|---|
| **Source** | Kolektor Group d.o.o. |
| **Research Institution** | University of Ljubljana, Slovenia |
| **Release Year** | 2021 |
| **Total Images** | 3,336 |
| **Defect Class** | 1 — Defect |
| **Labeled Objects** | 394 |
| **Training Images** | 2,332 |
| **Test Images** | 1,004 |
| **Annotations** | Pixel-level instance segmentation |

### What it is used for

KolektorSDD2 is used in this project for detecting **real-world surface defects**, including:

- Scratches
- Minor spots
- Small surface imperfections
- Larger surface defects

The dataset contains images of actual manufactured production items supplied by **Kolektor Group d.o.o.**, rather than synthetic computer-generated defects. :contentReference[oaicite:1]{index=1}

**Dataset Source:** [KolektorSDD2 — DatasetNinja](https://datasetninja.com/kolektor-surface-defect-dataset-2)

**Original Research:**  
Božič, Jakob; Tabernik, Domen; Skočaj, Danijel. *Mixed supervision for surface-defect detection: from weakly to fully supervised learning*, Computers in Industry, 2021.

---

## 🔗 Dataset Source Summary

| Dataset | Where the Data Comes From | Main Purpose |
|---|---|---|
| **MVTec LOCO AD** | MVTec industrial inspection scenarios, Germany | Structural + logical anomaly detection |
| **KolektorSDD2** | Production items from Kolektor Group d.o.o., Slovenia | Real-world surface-defect detection |

Together, these datasets allow the system to address two important aspects of manufacturing quality inspection:

**MVTec LOCO AD → "Is the product structurally and logically correct?"**

**KolektorSDD2 → "Does the product have a visible surface defect?"**
=======
# ds-innovate
>>>>>>> ds-innovate/main
