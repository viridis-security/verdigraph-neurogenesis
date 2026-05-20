// src/discovery/openapi_doc.ts — Iter3 P1.5: served at /openapi.yaml.
//
// OpenAPI 3.1 schema for the public HTTP surface of verdigraph.dev. Covers
// /app/import (the deterministic free-preview endpoint) exhaustively so
// downstream clients can codegen typed bindings instead of hand-deriving them.

export const OPENAPI_YAML = `openapi: 3.1.0
info:
  title: Verdigraph hosted MCP — public HTTP surface
  version: "1.0.0"
  description: |
    Public, auth-free HTTP endpoints exposed by the Verdigraph hosted MCP at
    https://verdigraph.dev. The OAuth-gated MCP endpoint at /mcp is documented
    via the SEP-1960 manifest at /.well-known/mcp and the SEP-1649 server card
    at /.well-known/mcp/server-card.json — this OpenAPI document only covers
    the public HTTP routes (import, discovery, conservation, marketplace,
    landing pages, URI-handler scripts).
  contact:
    name: Viridis Security
    url: https://verdigraph.dev
    email: hartjustin6@gmail.com
  license:
    name: MIT
servers:
  - url: https://verdigraph.dev
    description: Production
paths:
  /app/import:
    post:
      summary: Build a Verdigraph brain from an agent file (free preview, deterministic)
      description: |
        Auth-free. Identical input bytes always produce the same brain_id +
        content_hash + brain_uri (I-INV1). Response headers include
        x-verdigraph-brain-id, x-verdigraph-content-hash, and
        x-verdigraph-deterministic: 1 so CDN/edge caches can short-circuit
        safely on (input_sha256, extractor_version).
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [content]
              properties:
                format:
                  type: string
                  enum: [verdigraph_genome, claude_project_export, openai_assistant, prompt_list, auto]
                  default: auto
                content:
                  type: string
                  description: Stringified agent JSON (verdigraph_genome / claude / openai) or newline-separated prompts.
                session_id:
                  type: string
                  description: Optional live build session id for SSE pairing.
                  pattern: '^[A-Z0-9]{26}$'
      responses:
        '200':
          description: Brain built successfully
          headers:
            x-verdigraph-brain-id:
              schema: { type: string, pattern: '^[A-Z0-9]{26}$' }
            x-verdigraph-content-hash:
              schema: { type: string, pattern: '^[0-9a-f]{64}$' }
            x-verdigraph-deterministic:
              schema: { type: string, enum: ['1'] }
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ImportResponse' }
        '400':
          description: Invalid input
          content:
            application/json:
              schema:
                type: object
                properties: { error: { type: string }, format: { type: string } }
  /CANONICALIZATION.md:
    get:
      summary: Brain.v1 canonicalization specification
      responses:
        '200':
          description: Markdown spec
          content:
            text/markdown:
              schema: { type: string }
  /llms.txt:
    get:
      summary: llms.txt summary for crawling agents
      responses:
        '200': { description: Plain text, content: { text/plain: { schema: { type: string } } } }
  /.well-known/mcp:
    get:
      summary: SEP-1960 MCP manifest
      responses:
        '200': { description: JSON manifest }
  /.well-known/mcp/server-card.json:
    get:
      summary: SEP-1649 server card
      responses:
        '200': { description: JSON server card }
  /.well-known/verdigraph-attest-pubkey:
    get:
      summary: Public Ed25519 attestation key (raw 32-byte hex)
      responses:
        '200': { description: Plain text, content: { text/plain: { schema: { type: string } } } }
  /conservation/public:
    get:
      summary: Conservation ledger rollup
      responses:
        '200':
          description: 25% net-revenue rollup
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ConservationRollup' }
  /conservation/public/months:
    get:
      summary: Conservation by month (iter3 P1.3)
      responses:
        '200':
          description: Array of monthly buckets
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/ConservationMonth' }
  /conservation/public/brains:
    get:
      summary: Per-brain conservation attribution (iter3 P1.3)
      responses:
        '200':
          description: Array of per-brain rollups
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/ConservationBrain' }
  /conservation/public/payouts:
    get:
      summary: Conservation payout transactions (iter3 P1.3)
      responses:
        '200':
          description: Array of payout rows
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/ConservationPayout' }
  /marketplace:
    get:
      summary: Marketplace browse HTML (iter3 P1.8)
      responses: { '200': { description: HTML directory page } }
  /api/v1/mcp/pricing:
    get:
      summary: Per-tool live pricing for metered MCP tools (iter3 P1.1)
      responses:
        '200':
          description: Pricing map
          content:
            application/json:
              schema:
                type: object
                properties:
                  tools:
                    type: array
                    items:
                      type: object
                      properties:
                        name: { type: string }
                        metered: { type: boolean }
                        price_usd: { type: number, nullable: true }
                        summary: { type: string }
  /scripts/uri-handler/install-macos.sh:
    get: { summary: "Iter3 P0.2: verdigraph:// scheme installer (macOS)", responses: { '200': { description: bash script } } }
  /scripts/uri-handler/install-windows.ps1:
    get: { summary: "Iter3 P0.2: verdigraph:// scheme installer (Windows)", responses: { '200': { description: PowerShell script } } }
  /scripts/uri-handler/install-linux.sh:
    get: { summary: "Iter3 P0.2: verdigraph:// scheme installer (Linux)", responses: { '200': { description: bash script } } }
components:
  schemas:
    ImportResponse:
      type: object
      required: [ok, preview, invariants]
      properties:
        ok: { type: boolean }
        preview: { $ref: '#/components/schemas/BrainPreview' }
        invariants: { $ref: '#/components/schemas/InvariantReport' }
    BrainPreview:
      type: object
      required: [brain_id, brain_uri, content_hash, schema_version, agent_name, node_count, edge_count, node_ids, edges, sample_nodes, llm_bindings, provenance, paywall]
      properties:
        brain_id:      { type: string, pattern: '^[A-Z0-9]{26}$' }
        brain_uri:     { type: string, pattern: '^verdigraph://brain/[A-Z0-9]{26}$' }
        content_hash:  { type: string, pattern: '^[0-9a-f]{64}$' }
        schema_version: { type: string, enum: [brain.v1] }
        agent_name:    { type: string }
        purpose:       { type: string }
        node_count:    { type: integer, minimum: 1 }
        edge_count:    { type: integer, minimum: 0 }
        node_ids:
          type: array
          items:
            type: object
            properties:
              id:   { type: string }
              type: { $ref: '#/components/schemas/NodeType' }
        edges:
          type: array
          items:
            type: object
            properties:
              from: { type: string }
              to:   { type: string }
        sample_nodes:
          type: array
          maxItems: 8
          items:
            type: object
            properties:
              id:          { type: string }
              type:        { $ref: '#/components/schemas/NodeType' }
              description: { type: string }
        llm_bindings:
          type: array
          items: { $ref: '#/components/schemas/LlmBinding' }
        provenance:
          type: object
          properties:
            format:        { type: string }
            input_bytes:   { type: integer }
            input_sha256:  { type: string, pattern: '^[0-9a-f]{64}$' }
            extractor:     { type: string }
            built_at:      { type: string, format: date-time }
            warnings:      { type: array, items: { type: string } }
        paywall:
          type: object
          properties:
            product:    { type: string, enum: [single_brain_unlock] }
            amount_usd: { type: number }
    InvariantReport:
      type: object
      properties:
        brain_id: { type: string }
        passed:   { type: boolean, description: "Excludes advisory invariants (e.g. I9 doesn't drop this)." }
        checks:
          type: array
          items:
            type: object
            required: [id, description, passed]
            properties:
              id:                  { type: string }
              description:         { type: string }
              passed:              { type: boolean }
              passed_with_default: { type: boolean, description: "Iter2 P2.1: I8 sets this true when llm_bindings auto-defaults to provider='any'." }
              advisory:            { type: boolean, description: "Iter2 P2.3: I9_fitness_metric_wired is advisory through brain.v1." }
              detail:              { type: string, nullable: true }
    NodeType:
      type: string
      description: |
        Closed enum of cognitive node types. Documented in /CANONICALIZATION.md
        under '## Node taxonomy'. Future additions add rows; no removals.
      enum: [module, infrastructure, directive, knowledge, tool, prompt]
    LlmBinding:
      type: object
      required: [provider, required_tools, context_tokens]
      properties:
        provider:       { type: string, enum: [anthropic, openai, google, mistral, local, any] }
        model_hint:     { type: string }
        required_tools: { type: array, items: { type: string } }
        context_tokens: { type: integer, minimum: 0 }
    ConservationRollup:
      type: object
      properties:
        gross_revenue_usd:        { type: number }
        passthrough_cost_usd:     { type: number }
        net_revenue_usd:          { type: number }
        conservation_share_usd:   { type: number }
        conservation_committed:   { type: string, example: "25% of net revenue" }
        paid_out_usd:             { type: number }
    ConservationMonth:
      type: object
      properties:
        month: { type: string, example: "2026-05" }
        gross_revenue_usd:      { type: number }
        net_revenue_usd:        { type: number }
        conservation_share_usd: { type: number }
        paid_out_usd:           { type: number }
        payout_tx_id:           { type: string, nullable: true }
        payout_recipient:       { type: string, nullable: true }
    ConservationBrain:
      type: object
      properties:
        brain_id_or_hash:       { type: string, description: "Pseudonymous (content-hash truncated) if brain is private." }
        agent_name:             { type: string, nullable: true }
        contribution_usd:       { type: number }
        purchase_count:         { type: integer }
        first_contributed_at:   { type: string, format: date-time, nullable: true }
    ConservationPayout:
      type: object
      properties:
        month:        { type: string }
        amount_usd:   { type: number }
        recipient:    { type: string }
        tx_ref:       { type: string }
        verified_at:  { type: string, format: date-time, nullable: true }
`;
