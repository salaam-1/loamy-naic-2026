import os
import subprocess

import modal

app = modal.App("loam-natlas")
model_volume = modal.Volume.from_name("natlas-model")

image = modal.Image.from_registry(
    "ghcr.io/ggml-org/llama.cpp:server-cuda",
    add_python="3.11",
).entrypoint([])

@app.function(
    image=image,
    gpu="L4",
    cpu=4,
    memory=16384,
    timeout=3600,
    scaledown_window=300,
    volumes={
        "/models": model_volume.with_mount_options(read_only=True),
    },
    secrets=[
        modal.Secret.from_name(
            "natlas-api-key",
            required_keys=["NATLAS_API_KEY"],
        ),
    ],
)
@modal.web_server(
    port=8080,
    startup_timeout=900,
)
def serve():
    api_key = os.environ["NATLAS_API_KEY"]

    subprocess.Popen([
        "/app/llama-server",
        "--model", "/models/natlas-q4km.gguf",
        "--alias", "natlas-q4km:latest",
        "--host", "0.0.0.0",
        "--port", "8080",
        "--n-gpu-layers", "99",
        "--ctx-size", "4096",
        "--api-key", api_key,
    ])
