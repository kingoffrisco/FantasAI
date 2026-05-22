.PHONY: install run test lint docker-build docker-run

install:
	pip install -r requirements.txt

run:
	uvicorn app.main:app --reload

test:
	pytest

lint:
	python -m py_compile app/main.py app/config.py app/services/fantasy_apis.py

docker-build:
	docker build -t fantasai .

docker-run:
	docker run -p 8000:8000 --env-file .env fantasai
