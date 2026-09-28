# ToolPoker → PokerCoach: Product and Architecture Recommendations

Audience: PokerCoach product/engineering team  
Date: 25 August 2026  
Scope: Apply arXiv:2602.00528 to the current PokerCoach no-limit hold’em hand-analysis prototype. The paper evaluates mainly Leduc and heads-up limit hold’em, so its architectural evidence is treated as transferable; its numerical performance is not assumed to transfer directly to six-max NLHE.

## Executive answer

Yes. The paper strongly supports a change that fits PokerCoach’s current trajectory: make deterministic parsing, equity/range computation, and solver output a single validated evidence packet, then force both the recommendation and coaching explanation to be derived from that packet. Do not start by fine-tuning a poker LLM.

PokerCoach already has important foundations: import/card validation, deterministic hero-hand facts, legal-action constraints, an output validator, and a TexasSolver adapter. But the local recommendation, LLM explanations, LLM range interpretation, and solver check are currently launched as parallel panels. The solver result arrives after the local/LLM recommendation and is displayed as an optional side check. This leaves exactly the failure modes ToolPoker identifies: incorrect state sent to tools, factual claims detached from computed evidence, and a final recommendation that can diverge from the solver.

The recommended first milestone is a `PokerEvidencePacket` plus a `DecisionContract`:

- Canonical, versioned hand state with provenance and confidence for every imported field.
- A single server-side orchestration call returning legal actions, pot/call price, normalized ranges, equity, solver strategy distribution, EV/regret deltas when available, and explicit limitations.
- A deterministic decision policy that selects or preserves the solver mix before the LLM writes anything.
- A structured explanation response whose claims cite fields in the evidence packet and that fails validation if its recommendation, numbers, or legal actions disagree.

## What the paper actually demonstrates

The paper evaluates vanilla LLMs against DQN, DMC, NFSP, CFR+/DeepCFR in Leduc and limit hold’em. It diagnoses three recurring errors: heuristic reasoning, factual misunderstanding, and a “knowing–doing” gap between stated reasoning and final action. Behavior cloning on about 5,000 expert-style traces plus regret-inspired RL improved reasoning style but remained materially weaker than equilibrium methods.

ToolPoker changes the locus of computation. A unified solver API returns the action plus equity, pot odds, and range information in one tool response. The LLM learns to call it and use the result in a structured trace. In the paper’s 100-game evaluation blocks, ToolPoker’s Qwen2.5-7B model is close to CFR+/DeepCFR and substantially ahead of the same vanilla model and BC-RIRL. The authors’ ablations say action alignment is the dominant reward component; format and tool-success rewards help reliability but contribute less.

This conclusion is consistent with the underlying method family. Counterfactual Regret Minimization minimizes counterfactual regret and, in self-play, approaches Nash equilibrium in imperfect-information games. Deep CFR uses neural approximators to scale CFR without a manually specified abstraction. PokerBench independently finds that current LLMs underperform at NLHE decisions and provides 11,000 solver-labelled evaluation spots, making it a practical external test set for PokerCoach.

## Method-by-method product relevance

### 1. Unified tool inference — adopt now

Paper method: combine action solver, equity calculator, pot odds, and range distributions into one standardized API response.

PokerCoach today: browser-side code builds a heuristic range, estimates equity, calculates pot odds and a “confluence” score, and immediately chooses a local action. The TexasSolver endpoint runs separately and postflop only. Strategic LLM modes intentionally omit equity, EV, ranges, and the baseline because those local values may be unstable.

Implication: unify and promote verified computation server-side. One packet should include:

- `state`: game type, players, positions, stacks, blinds/antes, hole cards, board, action history, decision node, legal actions.
- `provenance`: manual/imported/derived source, field confidence, repair history, state hash.
- `range`: player ranges with weights, source and abstraction/version.
- `math`: pot, amount to call, pot odds, equity with sample count/method, EV definitions.
- `strategy`: action sizes and frequencies, node path, solver/version/configuration, accuracy, solve status.
- `limitations`: unsupported node, timeout, ambiguous import, missing stack, multiway approximation, range uncertainty.

The packet should be immutable for an analysis ID. UI panels and LLM prompts should consume the same packet rather than recomputing or selectively hiding conflicting values.

### 2. State encoding and validation — highest priority

Paper finding: ToolPoker’s residual errors include imperfect encoding of cards/public state before the solver query. The authors propose consistency-aware training signals.

PokerCoach fit: screenshot import makes this risk larger than in the paper’s clean simulator. PokerCoach already validates card collisions and action consistency and repairs hero attribution. Extend this into a `SolverStatePreflight` with hard invariants:

- Deck uniqueness, street/card-count validity, position/action order, stack and pot conservation.
- Amount-to-call and legal actions derived server-side, not trusted from presentation state.
- Solver node traversal must be complete; a missing action cannot silently fall back to the last matched node.
- Range tokens must be parseable, collision-free, normalized, and logged with weights.
- A canonical state hash must match across parser, calculator, solver, and explanation request.

When preflight fails, return “analysis unavailable” with the exact uncertain fields. Do not generate an authoritative recommendation from an ambiguous node.

### 3. Decision/action alignment — adopt now

Paper finding: the answer-alignment reward is the principal driver; ToolPoker can receive the correct tool output and still fail to follow it.

PokerCoach fit: the solver is currently a sibling panel, so a local or LLM recommendation can disagree with it without a single arbitration rule. Add a deterministic `DecisionContract`:

- If a supported, validated solver result exists, the displayed primary recommendation is its mixed strategy, not an LLM-selected action.
- If pedagogical UI requires one action, use a declared rule (highest frequency, sampled mix for drills, or EV-tolerance grouping) and retain the full frequency distribution.
- The LLM receives the selected action/mix as immutable evidence and explains it; it cannot replace it.
- If no trustworthy solver output exists, label the fallback as heuristic/skill-based and lower confidence. Never call it GTO.

Validation should parse structured LLM output and check action legality, action/mix agreement, numeric citations, and unsupported precision. The current validator mainly detects truncation, repetition, and missing Harrington sections, so it should become semantic.

### 4. Solver-augmented examples — useful after orchestration

Paper method: programmatically augment a compact expert-style dataset with standardized tool calls and outputs, then use behavior cloning; RL aligns tool use and action.

Product recommendation: do not fine-tune yet. First log high-quality `state → evidence packet → decision contract → explanation → validation` records. Curate only examples that pass all deterministic checks and cover meaningful NLHE strata: preflop/postflop, heads-up/multiway, stack depth, bet sizes, all-ins, imported/manual hands, and solver unavailable states.

Use this dataset initially for regression tests, prompt examples, and model comparison. Fine-tuning becomes rational only if telemetry shows persistent explanation/format failures that prompting and constrained decoding cannot solve economically.

### 5. Regret-inspired scoring — adapt for coaching, not training first

Paper method: use solver-derived regret as a dense step-level learning signal instead of sparse hand outcome.

PokerCoach opportunity: expose “cost of the mistake” rather than only “recommended action.” Where the solver can provide action EVs, report:

- Best action and mixed strategy.
- Hero’s recorded action.
- EV loss or regret relative to best action, preferably in bb and bb/100-normalized terms.
- Severity band with uncertainty/abstraction caveat.

This produces a better coaching product: users can prioritize large leaks rather than treating every frequency deviation equally. Avoid inventing regret from action frequency alone; require action EVs or a solver-supported proxy.

### 6. HR / FA / AC evaluation — adopt as an offline rubric

The paper scores heuristic reasoning (HR), factual alignment (FA), and action–reasoning consistency (AC), with an LLM judge calibrated against humans. PokerCoach can implement more deterministic versions:

- `FA`: exact match of cards, pot, price, equities, ranges, board texture facts, and solver values to packet fields.
- `AC`: recommended action is legal and agrees with the decision contract; candidate actions match the legal set.
- `HR`: explanation mentions the decision-relevant quantities and range interaction, avoids unsupported hand-strength shortcuts, and states uncertainty.

Use an LLM judge only for the residual qualitative part of HR. Treat judge scores as diagnostics, not ground truth.

## Prioritized roadmap

### Phase 1 — Evidence contract and semantic gates (1–2 engineering weeks)

1. Define `PokerStateV1`, `PokerEvidencePacketV1`, and `DecisionContractV1` JSON schemas.
2. Move pot/legal-action derivation and equity/range normalization behind one server endpoint.
3. Add state hashes and provenance/confidence per imported field.
4. Expand validation to action legality, action/evidence agreement, numeric grounding, solver-node completeness, and unsupported precision.
5. Display a clear mode badge: `Solver-grounded`, `Calculated fallback`, or `Incomplete state`.

Acceptance targets: zero illegal recommendations in the test corpus; zero recommendation/solver disagreements when the solver packet is valid; every displayed number traceable to a packet field.

### Phase 2 — Solver-grounded coaching (2–4 weeks)

1. Make the solver result part of the main analysis orchestration, not a late sibling request.
2. Add action-frequency and, if obtainable, action-EV/regret output.
3. Generate explanations from a strict JSON schema with evidence references.
4. Add cache keys from state hash + range version + solver configuration.
5. Preserve graceful fallbacks for preflop, all-in, multiway, timeout, and unsupported trees.

Acceptance targets: ≥99% semantic-validation pass rate on supported states after one retry; fallback labels always accurate; latency and solver failures observable by node class.

### Phase 3 — Evaluation harness and learning loop (2–3 weeks)

1. Build a stratified golden set from current regression fixtures, curated real imports, and PokerBench NLHE spots where license/format fit is confirmed.
2. Track decision accuracy, EV/regret loss, FA, AC, illegal-action rate, state-preflight failure, unsupported-precision rate, latency, and cache hit rate.
3. Run ablations: current pipeline vs evidence packet; heuristic recommendation vs solver contract; free-form vs structured grounded explanation.
4. Curate solver-grounded traces only after passing deterministic validation.

### Phase 4 — Fine-tuning decision gate (later)

Consider SFT or RL only when there are enough validated traces and a measured unresolved problem. For a coaching product, constrained generation plus a strong external solver may deliver most of ToolPoker’s value without the complexity of PPO. If training is pursued, prioritize action/evidence faithfulness over prose format, matching the paper’s ablation.

## Product experiments

1. “Why this mix?”: compare solver mix + cited evidence against the current independent commentary. Measure factual errors, user trust, and time-to-understanding.
2. “Leak severity”: show action EV loss/regret for the recorded action. Measure whether users revisit high-cost mistakes and improve on similar spots.
3. “Uncertainty-aware import”: allow users to correct only the fields that block solver preflight. Measure correction completion and solver-success lift.
4. “Explanation modes”: concise, study, and advanced views generated from the same packet. Measure usefulness without changing the underlying action.
5. “Off-equilibrium sensitivity”: perturb opponent range weights and bet sizes, then show which recommendations are robust versus assumption-sensitive.

## Important limitations and cautions

- The paper’s principal experiments are Leduc and heads-up limit hold’em in RLCard, not PokerCoach’s six-max no-limit cash-hand analysis. Its architecture transfers more safely than its headline chip results.
- The evaluation uses 100 games per matched comparison. Poker outcomes have high variance; treat chip totals as directional, not a precise estimate of win rate.
- “GTO-guaranteed” is conditional on the solver game, abstraction, ranges, action tree, convergence settings, and correctly encoded state. PokerCoach’s TexasSolver adapter currently uses fixed 50% bets/60% raises, derives effective stack as four times pot, uses low default iteration settings, and may not represent the imported hand’s actual tree. The UI should not present this as exact GTO until those inputs are faithful.
- ToolPoker’s LLM-judge reasoning scores are useful but partly subjective. PokerCoach should replace judgeable factual/alignment criteria with deterministic tests where possible.
- Multiway NLHE and off-tree actions need explicit approximation policies. The paper’s three-player evidence is on a simpler game and does not validate multiway NLHE solving.
- A coaching tool should avoid real-time assistance during active play and clearly position solver analysis for study/review, with responsible-gambling safeguards.

## Decision

Proceed with the unified evidence packet and semantic decision contract. This is a high-confidence recommendation because it is supported by the paper’s strongest ablation and directly resolves architectural splits visible in PokerCoach. Defer model fine-tuning. Treat solver fidelity, state validation, and evaluation infrastructure as prerequisites.

## Sources

1. Minhua Lin et al., “How Far Are LLMs from Professional Poker Players? Revisiting Game-Theoretic Reasoning with Agentic Tool Use,” arXiv, submitted 31 January 2026. https://arxiv.org/html/2602.00528
2. Martin Zinkevich et al., “Regret Minimization in Games with Incomplete Information,” NeurIPS 2007. https://papers.nips.cc/paper_files/paper/2007/file/08d98638c6fcd194a4b1e6992063e944-Paper.pdf
3. Noam Brown et al., “Deep Counterfactual Regret Minimization,” ICML 2019. https://proceedings.mlr.press/v97/brown19b.html
4. Richard Zhuang et al., “PokerBench: Training Large Language Models to Become Professional Poker Players,” AAAI 2025. https://ojs.aaai.org/index.php/AAAI/article/download/34814/36969
5. PokerBench repository and dataset description. https://github.com/pokerllm/pokerbench

## Claim-to-source ledger

- LLM flaw taxonomy, ToolPoker design, 5k samples, composite rewards, ablations, errors, and numerical results: Source 1; direct HTML access.
- CFR convergence rationale: Source 2; original paper PDF.
- DeepCFR purpose and scalability: Source 3; original ICML proceedings page.
- PokerBench scenario count, NLHE relevance, solver-labelled design, and SFT limitations: Sources 4–5; paper and official repository.
- PokerCoach architecture observations: local repository inspection on 25 August 2026, especially `public/app.js`, `src/analysis/pipeline.js`, `src/solver/texasSolverAdapter.js`, and `src/analysis/strategicOutputValidation.js`.

