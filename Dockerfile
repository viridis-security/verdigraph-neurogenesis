# syntax=docker/dockerfile:1.6
#
# Glama-grade build for the verdigraph stdio MCP server.
# Glama evaluates the server by building this image, starting the CMD,
# and issuing an MCP `tools/list` introspection request. The pure-Python
# core has zero non-stdlib deps; the `[mcp]` extra pulls `mcp[cli]>=1.0`
# and `pydantic>=2.0` for the stdio transport.
#
FROM python:3.12-slim

LABEL org.opencontainers.image.title="verdigraph-mcp" \
      org.opencontainers.image.description="Deterministic agent-brain MCP server (stdio)" \
      org.opencontainers.image.source="https://github.com/viridis-security/verdigraph-neurogenesis" \
      org.opencontainers.image.documentation="https://github.com/viridis-security/verdigraph-neurogenesis#readme" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="Viridis LLC"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Copy only the install surface — README is referenced from pyproject.toml,
# verdigraph/ is the pure-Python core, verdigraph_mcp/ is the stdio server.
COPY pyproject.toml README.md ./
COPY verdigraph ./verdigraph
COPY verdigraph_mcp ./verdigraph_mcp

# Editable install with the mcp extra brings mcp[cli]>=1.0 + pydantic>=2.0
RUN pip install --no-cache-dir -e ".[mcp]"

# The stdio entry point is registered as `verdigraph-mcp` in pyproject.toml.
# Glama will wire stdin/stdout to this process and exchange JSON-RPC messages
# per the MCP HTTP-stdio transport spec to verify introspection.
CMD ["verdigraph-mcp"]
