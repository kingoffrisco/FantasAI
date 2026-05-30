from typing import Any


class RetrievalPipeline:
    def __init__(self) -> None:
        self.vector_endpoint = None

    def index_documents(self, documents: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "status": "not_implemented",
            "document_count": len(documents),
        }

    def retrieve(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        return [
            {
                "query": query,
                "top_k": top_k,
                "status": "not_implemented",
            }
        ]
