from pathlib import Path
import uuid
import werkzeug

if not hasattr(werkzeug, "__version__"):
    try:
        import importlib.metadata
        werkzeug.__version__ = importlib.metadata.version("werkzeug")
    except Exception:
        werkzeug.__version__ = "3.0.0"

from flask import (
    Flask,
    jsonify,
    request,
    send_from_directory,
)
from flask_cors import CORS

from services.inference_service import InferenceService
from services.reasoning_service import generate_reasoning


# ============================================================
# APP CONFIGURATION
# ============================================================

app = Flask(__name__)

CORS(app)

BACKEND_DIR = Path(__file__).resolve().parent

UPLOAD_DIR = BACKEND_DIR / "uploads"

UPLOAD_DIR.mkdir(
    parents=True,
    exist_ok=True,
)

ALLOWED_EXTENSIONS = {
    "png",
    "jpg",
    "jpeg",
    "webp",
}


# ============================================================
# PATCHCORE SERVICE
# ============================================================

print("\nInitializing inspection service...")

inference_service = InferenceService()

print("[OK] Inspection service ready")


# ============================================================
# HELPERS
# ============================================================

def allowed_file(filename):

    if not filename:
        return False

    extension = (
        filename.rsplit(".",1)[-1]
        .lower()
    )

    return extension in ALLOWED_EXTENSIONS


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health")
def health():

    return jsonify({
        "status": "ok",
        "service": "Visual Quality Inspection API",
        "model": "PatchCore",
    })


# ============================================================
# INSPECTION ENDPOINT
# ============================================================

def process_image_file(image):
    if not image or not image.filename:
        return {"success": False, "error": "Image filename is empty."}, 400

    if not allowed_file(image.filename):
        return {
            "success": False,
            "filename": image.filename,
            "error": (
                "Unsupported image format. "
                "Use PNG, JPG, JPEG, or WEBP."
            ),
        }, 400

    image_path = None

    try:
        extension = (
            image.filename
            .rsplit(".", 1)[-1]
            .lower()
        )

        filename = f"{uuid.uuid4().hex}.{extension}"
        image_path = UPLOAD_DIR / filename
        image.save(image_path)

        print(f"\nUploaded image: {image_path}")

        result = inference_service.inspect(image_path)

        reasoning = generate_reasoning(
            status=result["status"],
            anomaly_score=result["anomaly_score"],
            defect_type=None,
        )

        visualization = result.get("visualization", None)

        response = {
            "success": True,
            "filename": image.filename,
            "inspection": {
                "status": result["status"],
                "anomaly_detected": result["anomaly_detected"],
                "anomaly_score": result["anomaly_score"],
            },
            "localization": {
                "bounding_box": result["bounding_box"],
                "anomaly_map_size": result["anomaly_map_size"],
            },
            "visualization": visualization,
            "analysis": {
                "defect_type": None,
                "reason": reasoning["reason"],
                "potential_impact": reasoning["potential_impact"],
                "recommended_action": reasoning["recommended_action"],
            },
        }

        return response, 200

    except Exception as error:
        print("\n" + "=" * 60)
        print("INSPECTION ERROR")
        print("=" * 60)
        print(error)

        return {
            "success": False,
            "filename": getattr(image, "filename", "unknown"),
            "error": str(error),
        }, 500

    finally:
        if image_path is not None and image_path.exists():
            try:
                image_path.unlink()
            except OSError:
                pass


# ============================================================
# INSPECTION ENDPOINTS
# ============================================================

@app.post("/api/inspect")
def inspect_product():

    if "image" not in request.files:
        return jsonify({
            "success": False,
            "error": (
                "No image provided. "
                "Use form-data field 'image'."
            ),
        }), 400

    image = request.files["image"]
    response, status_code = process_image_file(image)
    return jsonify(response), status_code


@app.post("/api/inspect-batch")
def inspect_batch():

    uploaded_files = request.files.getlist("images")
    if not uploaded_files:
        uploaded_files = request.files.getlist("image")

    if not uploaded_files:
        return jsonify({
            "success": False,
            "error": (
                "No images provided. "
                "Use form-data field 'images' or 'image'."
            ),
        }), 400

    results = []
    for file in uploaded_files:
        if not file or not file.filename:
            continue
        data, _ = process_image_file(file)
        results.append(data)

    total = len(results)
    passed = sum(
        1 for r in results
        if r.get("success") and r.get("inspection", {}).get("status") == "PASS"
    )
    failed = sum(
        1 for r in results
        if r.get("success") and r.get("inspection", {}).get("status") == "FAIL"
    )
    errors = sum(1 for r in results if not r.get("success"))

    return jsonify({
        "success": True,
        "total": total,
        "passed": passed,
        "failed": failed,
        "errors": errors,
        "results": results,
    }), 200


# ============================================================
# SERVE GENERATED VISUALIZATIONS
# ============================================================

@app.get(
    "/outputs/inspections/<inspection_id>/<filename>"
)
def get_inspection_output(
    inspection_id,
    filename,
):

    output_directory = (
        BACKEND_DIR
        / "outputs"
        / "inspections"
        / inspection_id
    )

    return send_from_directory(
        output_directory,
        filename,
    )


# ============================================================
# SERVER
# ============================================================

if __name__ == "__main__":

    print("\n" + "=" * 60)
    print("VISUAL QUALITY INSPECTION API")
    print("=" * 60)

    print(
        "Health: "
        "http://127.0.0.1:5000/api/health"
    )

    print(
        "Inspect: "
        "POST http://127.0.0.1:5000/api/inspect"
    )

    print(
        "Outputs: "
        "http://127.0.0.1:5000/outputs/inspections/"
    )

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True,
    )