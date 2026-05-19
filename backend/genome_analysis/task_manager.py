"""Task manager for background analysis jobs."""

import json
import uuid
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Literal, Optional

from backend.config import GRCG6A_GENOME_OUTPUT

JobStatus = Literal["pending", "running", "success", "failed"]

# Output directory
_genome_output_dir = GRCG6A_GENOME_OUTPUT
_genome_output_dir.mkdir(parents=True, exist_ok=True)


class GenomeTaskManager:
    """Simple in-memory task manager for background jobs."""

    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._lock = Lock()

    def create_job(self) -> dict:
        """Create a new analysis job."""
        job_id = str(uuid.uuid4())[:8]
        output_dir = _genome_output_dir / job_id

        job = {
            "job_id": job_id,
            "status": "pending",
            "created_at": datetime.now().isoformat(),
            "started_at": None,
            "finished_at": None,
            "message": None,
            "error": None,
            "output_dir": str(output_dir),
        }

        with self._lock:
            self._jobs[job_id] = job

        # Create output directory
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "metadata").mkdir(exist_ok=True)
        (output_dir / "result").mkdir(exist_ok=True)
        (output_dir / "charts").mkdir(exist_ok=True)
        (output_dir / "tables").mkdir(exist_ok=True)

        # Save metadata
        self._save_job(job)

        return job

    def get_job(self, job_id: str) -> Optional[dict]:
        """Get job metadata from memory, fallback to disk."""
        with self._lock:
            if job_id in self._jobs:
                return self._jobs[job_id]
            # Fallback: load from disk if not in memory
            job_dir = _genome_output_dir / job_id
            metadata_file = job_dir / "metadata" / "job.json"
            if metadata_file.exists():
                try:
                    with open(metadata_file, "r", encoding="utf-8") as f:
                        job = json.load(f)
                    self._jobs[job_id] = job
                    return job
                except Exception:
                    pass
            return None

    def update_job(
        self,
        job_id: str,
        status: JobStatus,
        message: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        """Update job status."""
        with self._lock:
            if job_id in self._jobs:
                job = self._jobs[job_id]
                job["status"] = status

                if status == "running" and job["started_at"] is None:
                    job["started_at"] = datetime.now().isoformat()

                if status in ("success", "failed"):
                    job["finished_at"] = datetime.now().isoformat()

                if message:
                    job["message"] = message
                if error:
                    job["error"] = error

                self._save_job(job)

    def _save_job(self, job: dict) -> None:
        """Save job metadata to file."""
        job_dir = Path(job["output_dir"])
        metadata_file = job_dir / "metadata" / "job.json"
        with open(metadata_file, "w", encoding="utf-8") as f:
            json.dump(job, f, indent=2, ensure_ascii=False)

    def list_jobs(self) -> list[dict]:
        """List all jobs from memory, fallback to disk scan."""
        with self._lock:
            if not self._jobs:
                self._load_jobs_from_disk()
            return list(self._jobs.values())

    def _load_jobs_from_disk(self) -> None:
        """Scan output directory and load all job metadata from disk."""
        if not _genome_output_dir.exists():
            return
        for job_dir in _genome_output_dir.iterdir():
            if not job_dir.is_dir():
                continue
            metadata_file = job_dir / "metadata" / "job.json"
            if metadata_file.exists():
                try:
                    with open(metadata_file, "r", encoding="utf-8") as f:
                        job = json.load(f)
                    job_id = job.get("job_id")
                    if job_id:
                        self._jobs[job_id] = job
                except Exception:
                    pass


# Global task manager instance
genome_task_manager = GenomeTaskManager()
