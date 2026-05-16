#!/usr/bin/env python
"""RunPod Serverless handler for the MocapExpo WHAM worker image."""

from __future__ import annotations

import json
import os
import subprocess
import time
from typing import Any

import runpod


APP_DIR = "/app/backend"
MAX_OUTPUT_CHARS = int(os.environ.get("RUNPOD_HANDLER_MAX_OUTPUT_CHARS", "12000"))


def _tail(value: str) -> str:
    if len(value) <= MAX_OUTPUT_CHARS:
        return value
    return value[-MAX_OUTPUT_CHARS:]


def _run_node(args: list[str], timeout_s: int) -> dict[str, Any]:
    started = time.time()
    completed = subprocess.run(
        ["node", *args],
        cwd=APP_DIR,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_s,
        check=False,
    )
    return {
        "returncode": completed.returncode,
        "durationSeconds": round(time.time() - started, 3),
        "stdout": _tail(completed.stdout),
        "stderr": _tail(completed.stderr),
    }


def _run_command(args: list[str], timeout_s: int, cwd: str = APP_DIR) -> dict[str, Any]:
    started = time.time()
    completed = subprocess.run(
        args,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_s,
        check=False,
    )
    return {
        "returncode": completed.returncode,
        "durationSeconds": round(time.time() - started, 3),
        "stdout": _tail(completed.stdout),
        "stderr": _tail(completed.stderr),
    }


def _coerce_timeout(value: Any, default_s: int) -> int:
    if value is None:
        return default_s
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default_s
    return max(1, parsed)


def handler(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("input") or {}
    if not isinstance(payload, dict):
        return {"ok": False, "error": "RunPod input must be a JSON object."}

    job_id = payload.get("jobId")
    mode = payload.get("mode")
    timeout_s = _coerce_timeout(payload.get("timeoutSeconds"), 3600)

    if job_id == "preflight" or mode == "preflight":
        result = _run_node(["dist/worker/whamDeploymentPreflight.js"], timeout_s)
        return {
            "ok": result["returncode"] == 0,
            "mode": "preflight",
            **result,
        }

    if mode == "benchmark":
        video_path = payload.get("videoPath") or "/workspace/WHAM/examples/IMG_9732_5s.mov"
        output_dir = payload.get("outputDir") or "/workspace/WHAM/output/runpod_benchmark"
        if not isinstance(video_path, str) or not video_path.startswith("/"):
            return {"ok": False, "mode": "benchmark", "error": "videoPath must be absolute."}
        if not isinstance(output_dir, str) or not output_dir.startswith("/"):
            return {"ok": False, "mode": "benchmark", "error": "outputDir must be absolute."}
        output_path = os.path.join(output_dir, "solved_motion.json")
        solver = os.environ.get("WHAM_SOLVER_SCRIPT", "worker/model_adapters/wham_solver.py")
        python_path = os.environ.get("PYTHON_PATH", "python")
        args = [
            python_path,
            solver if os.path.isabs(solver) else os.path.join(APP_DIR, solver),
            "--video",
            video_path,
            "--output",
            output_path,
            "--solver-version",
            os.environ.get("WHAM_SOLVER_VERSION", "wham_adapter_v1"),
            "--source",
            "single_camera",
            "--take-id",
            "runpod_benchmark",
            "--job-id",
            "runpod_benchmark",
        ]
        if os.environ.get("WHAM_REPO_DIR"):
            args.extend(["--wham-repo", os.environ["WHAM_REPO_DIR"]])
        if os.environ.get("WHAM_CONFIG_PATH"):
            args.extend(["--wham-config", os.environ["WHAM_CONFIG_PATH"]])
        if os.environ.get("WHAM_ESTIMATE_LOCAL_ONLY", "false") == "true":
            args.append("--estimate-local-only")
        if os.environ.get("WHAM_RENDER_OVERLAY_PREVIEW", "false") == "true":
            args.append("--render-overlay-preview")
        result = _run_command(args, timeout_s)
        return {
            "ok": result["returncode"] == 0,
            "mode": "benchmark",
            "videoPath": video_path,
            "outputPath": output_path,
            "overlayPreviewPath": os.path.join(output_dir, "wham_work", "output.mp4"),
            **result,
        }

    args = ["dist/worker/runpodServerlessJob.js"]
    if isinstance(job_id, str) and job_id:
        args.extend(["--job-id", job_id])
    else:
        args.append("--claim-next")

    result = _run_node(args, timeout_s)
    return {
        "ok": result["returncode"] == 0,
        "mode": "process-job",
        "jobId": job_id,
        **result,
    }


runpod.serverless.start({"handler": handler})
