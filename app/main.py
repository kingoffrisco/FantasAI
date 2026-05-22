from fastapi import FastAPI

from app.config import settings

app = FastAPI(title="FantasAI API", version="0.1.0")


@app.get("/")
def read_root() -> dict[str, str]:
    return {
        "name": "FantasAI",
        "environment": settings.app_env,
        "status": "ok",
    }


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "healthy"}
