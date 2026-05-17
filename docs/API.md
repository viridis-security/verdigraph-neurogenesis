# Minimal API Sketch

This repo is a Python package first. A service layer can expose the following endpoints.

```http
POST /agents
Create agent from genome.

GET /agents/{id}/graph
Return graph state.

POST /agents/{id}/evaluations
Submit task outcome.

GET /agents/{id}/ledger
Return developmental history.

POST /agents/{id}/growth-events
Request reviewed growth action.

POST /agents/{id}/pruning-events
Request reviewed pruning action.
```

Future implementation can use FastAPI with PostgreSQL and a graph visualization frontend.
