from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root() -> None:
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "FantasAI"
    assert data["status"] == "ok"


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_trending_from_databricks_stub() -> None:
    response = client.get("/players/trending/from-databricks")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "not_implemented"
