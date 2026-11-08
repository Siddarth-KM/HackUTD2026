"""Cross-deal linkage graph: the detector for tricks no single deal reveals.

Idea: fraud rings reuse infrastructure. Two deals are LINKED when they share tokens that are RARE in the
whole corpus (a year of history + all live deals), where rarity is information content  w = ln(N / f).
A token everybody shares (the biggest registered agent, the common PDF producer) carries almost no weight; a
token shared by 3 of 270 deals carries a lot.

A link needs:  (1) summed weight of shared STRONG tokens >= CLUSTER_MIN_SCORE, and
               (2) those tokens spanning >= CLUSTER_MIN_FAMILIES independent families.
Requirement (2) is what keeps honest coincidences out: sharing one rare thing (a preparer) is common among
unrelated honest businesses; sharing rare things across paperwork-tool, people AND money rails is not.

No rule is specific to any trick. A new trick that reuses ANY combination of these rails is caught; a trick
that reuses something not yet modelled needs a new token source in features.py, not new graph logic.
"""
from __future__ import annotations
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from itertools import combinations
from .. import config
from .features import Profile, FAMILIES
from ..validate.textnorm import person_match, entity_match


# Tokens that restate the same underlying fact are scored ONCE (the strongest), otherwise a preparer's name AND
# phone, or a vendor's name AND account, would count as independent evidence.
FACT_GROUP = {
    "preparer_phone": "preparer", "preparer": "preparer",
    "agent": "agent", "agent_addr": "agent",
    "vendor_acct": "vendor_rail", "remit": "vendor_rail", "lookalike_vendor": "vendor_rail",
    "dl": "identity", "ssn4_dob": "identity",
    "creator": "tool", "producer": "tool", "stmt_producer": "tool", "single_tool": "tool",
    "layout_application": "shape", "layout_bank_statement": "shape", "layout_equipment_quote": "shape",
    "layout_financial_statements": "shape",
    "phone": "contact", "email_domain": "contact",
}


# Attributes that exist only for LIVE deals (history rows do not record them). Their rarity must be measured against
# the live population, otherwise they look artificially rare while only a handful of live deals have arrived.
LIVE_ONLY = {"creator", "stmt_producer", "single_tool", "home_addr", "phone", "email_domain", "acct", "lookalike_vendor",
             "remit_full", "layout_application", "layout_bank_statement", "layout_equipment_quote", "layout_financial_statements"}


def token_key(token: str) -> str:
    return token.split(":", 1)[1].split("=", 1)[0]


def fact_group(token: str) -> str:
    key = token_key(token)
    return FACT_GROUP.get(key, key)


@dataclass
class Edge:
    a: str
    b: str
    score: float
    families: set[str]
    shared: list[tuple[str, float, int]]          # (token, weight, corpus frequency)
    extra: list[str] = field(default_factory=list)  # pairwise evidence not expressible as a token

    def dict(self):
        return {"a": self.a, "b": self.b, "score": round(self.score, 2), "families": sorted(self.families),
                "shared": [{"token": t, "weight": round(w, 2), "freq": f} for t, w, f in self.shared], "extra": self.extra}


@dataclass
class Cluster:
    members: list[str]
    score: float
    edges: list[Edge]
    families: set[str]

    def dict(self):
        return {"members": self.members, "score": round(self.score, 2), "families": sorted(self.families),
                "edges": [e.dict() for e in self.edges]}


class RingGraph:
    def __init__(self, profiles: list[Profile]):
        self.p = {x.pid: x for x in profiles}
        self.N = max(len(profiles), 1)
        self.N_live = max(sum(1 for x in profiles if x.kind == "live"), 1)
        self.freq: Counter = Counter()
        self.index: dict[str, list[str]] = defaultdict(list)
        for x in profiles:
            for t in x.tokens:
                self.freq[t] += 1
                self.index[t].append(x.pid)

    def weight(self, token: str) -> float:
        n = self.N_live if token_key(token) in LIVE_ONLY else self.N
        return math.log(max(n, 1) / self.freq[token])

    # ------------------------------------------------------------------ edges
    def edges(self, min_score: float | None = None, min_families: int | None = None) -> list[Edge]:
        min_score = config.CLUSTER_MIN_SCORE if min_score is None else min_score
        min_families = config.CLUSTER_MIN_FAMILIES if min_families is None else min_families
        pair_tokens: dict[tuple[str, str], list[str]] = defaultdict(list)
        for t, pids in self.index.items():
            if len(pids) < 2 or self.weight(t) < config.STRONG_ATTR_MIN_WEIGHT:
                continue
            if len(pids) > max(12, self.N // 10):   # a token on >10% of deals is infrastructure, not a fingerprint
                continue
            for a, b in combinations(sorted(pids), 2):
                pair_tokens[(a, b)].append(t)
        out: dict[tuple[str, str], Edge] = {}
        for (a, b), toks in pair_tokens.items():
            best: dict[str, str] = {}
            for t in toks:
                g = fact_group(t)
                if g not in best or self.weight(t) > self.weight(best[g]):
                    best[g] = t
            shared = [(t, self.weight(t), self.freq[t]) for t in best.values()]
            fams = {self.p[a].tokens[t] for t in best.values()}
            score = sum(w for _, w, _ in shared)
            if score >= min_score and len(fams) >= min_families:
                out[(a, b)] = Edge(a, b, score, fams, sorted(shared, key=lambda s: -s[1]))
        # Conclusive single-attribute CONFLICTS (any two deals, live or history): one real-world identifier that can
        # only belong to one party, claimed by two different parties.
        for (a, b), edge in self._conflicts().items():
            e = out.get((a, b)) or Edge(a, b, 0.0, set(), [])
            e.extra = e.extra + edge
            e.score += 12.0 * len(edge)
            e.families |= {"identity" if "ID number" in x or "SSN" in x else "money_conflict" for x in edge}
            out[(a, b)] = e
        # Pairwise evidence between two LIVE deals is conclusive on its own: an identical ledger or money flowing
        # between the applicants is not something honest unrelated businesses produce.
        live = sorted((x for x in self.p.values() if x.kind == "live"), key=lambda q: q.pid)
        for x, y in combinations(live, 2):
            extra = self._pairwise(x.pid, y.pid)
            if not extra:
                continue
            e = out.get((x.pid, y.pid)) or Edge(x.pid, y.pid, 0.0, set(), [])
            e.extra = extra
            e.score += 8.0 * len(extra)
            e.families |= {"ledger" if "identical" in ex else "flow" for ex in extra}
            out[(x.pid, y.pid)] = e
        return list(out.values())

    def _conflicts(self) -> dict[tuple[str, str], list[str]]:
        found: dict[tuple[str, str], list[str]] = defaultdict(list)
        for key, label in (("dl", "the same driver-licence / ID number"), ("ssn4_dob", "the same SSN-last-4 and date of birth")):
            for t, pids in self.index.items():
                if token_key(t) != key or len(pids) < 2:
                    continue
                for a, b in combinations(sorted(pids), 2):
                    ga, gb = self.p[a].meta.get("guarantor"), self.p[b].meta.get("guarantor")
                    if ga and gb and not person_match(ga, gb):
                        found[(a, b)].append(f"{label} appears under two different names: '{ga}' and '{gb}' (ID number reused)")
        for t, pids in self.index.items():
            if token_key(t) != "remit_full" or len(pids) < 2:
                continue
            for a, b in combinations(sorted(pids), 2):
                va, vb = self.p[a].meta.get("vendor"), self.p[b].meta.get("vendor")
                if va and vb and not entity_match(va, vb):
                    found[(a, b)].append(f"one remit-to bank account is used by two different 'vendors': '{va}' and '{vb}'")
        return found

    def _pairwise(self, a: str, b: str) -> list[str]:
        """Evidence between two LIVE deals that is not a shared token."""
        x, y = self.p[a], self.p[b]
        if x.kind != "live" or y.kind != "live":
            return []
        out = []
        nx, ny = sum(x.txn_sig.values()), sum(y.txn_sig.values())
        if nx >= 12 and ny >= 12:
            ratio = sum((x.txn_sig & y.txn_sig).values()) / min(nx, ny)
            if ratio >= 0.6:
                out.append(f"{ratio:.0%} of bank transactions are identical (same amount and description pattern) across both deals")
        for src, dst in ((x, y), (y, x)):
            for nm in dst.own_names:
                if len(nm) >= 8 and any(nm.upper() in d for d in src.counterparties):
                    out.append(f"{src.label} bank transactions name {dst.label} as a counterparty (possible circular funding)")
                    break
        return out

    # ------------------------------------------------------------------ clusters
    def tight_group_edges(self) -> list[Edge]:
        """Edges that belong to a TRIANGLE of two-family links (score >= GROUP_MIN_SCORE per pair).
        One pair sharing two rare things can be coincidence; three or more deals that ALL pairwise share them cannot
        reasonably be. (A year of honest history contains no such pair at all, let alone a triangle.)"""
        rel = self.edges(config.GROUP_MIN_SCORE, config.CLUSTER_MIN_FAMILIES)
        adj: dict[str, set[str]] = defaultdict(set)
        by_pair = {}
        for e in rel:
            adj[e.a].add(e.b)
            adj[e.b].add(e.a)
            by_pair[(e.a, e.b)] = e
            by_pair[(e.b, e.a)] = e
        keep: dict[tuple[str, str], Edge] = {}
        for a in adj:
            for b, c in combinations(sorted(adj[a]), 2):
                if c in adj[b]:
                    for u, v in ((a, b), (a, c), (b, c)):
                        e = by_pair[(u, v)]
                        keep[(e.a, e.b)] = e
        return list(keep.values())

    def clusters(self, edges: list[Edge] | None = None) -> list[Cluster]:
        if edges is None:
            strict = self.edges()
            have = {(e.a, e.b) for e in strict} | {(e.b, e.a) for e in strict}
            edges = strict + [e for e in self.tight_group_edges() if (e.a, e.b) not in have]
        parent = {}

        def find(u):
            parent.setdefault(u, u)
            while parent[u] != u:
                parent[u] = parent[parent[u]]
                u = parent[u]
            return u

        for e in edges:
            parent[find(e.a)] = find(e.b)
        groups: dict[str, list[str]] = defaultdict(list)
        for e in edges:
            for n in (e.a, e.b):
                if n not in groups[find(n)]:
                    groups[find(n)].append(n)
        out = []
        for root, members in groups.items():
            es = [e for e in edges if find(e.a) == root]
            fams = set().union(*(e.families for e in es))
            out.append(Cluster(sorted(members), sum(e.score for e in es) / len(es), es, fams))
        return sorted(out, key=lambda c: -len(c.members))

    def relatives(self, seeds: set[str], min_score: float = 6.0, min_families: int = 2) -> dict[str, Edge]:
        """'Help the team find the rest': once some deal is CONFIRMED bad, anything linked to it by a relaxed edge
        is worth a look. (Still requires >=2 families, so honest coincidences stay out: best honest pair in a year
        of history scores 4.9 on 1 family.)"""
        out: dict[str, Edge] = {}
        for e in self.edges(min_score, min_families):
            if e.a in seeds and e.b not in seeds:
                out.setdefault(e.b, e)
            elif e.b in seeds and e.a not in seeds:
                out.setdefault(e.a, e)
        return out

    # ------------------------------------------------------------------ explanation
    def evidence(self, cluster: Cluster, limit: int | None = 7) -> list[dict]:
        """The shared rare attributes of a cluster as data (rarest first): what is shared, which evidence family it
        belongs to, how many deals carry it, and how many of the group share it. explain() and the UI both use this."""
        agg: dict[str, tuple[float, int, set[str]]] = {}
        for e in cluster.edges:
            for t, w, f in e.shared:
                agg.setdefault(t, (w, f, set()))[2].update({e.a, e.b})
        out = []
        for t, (w, f, who) in sorted(agg.items(), key=lambda kv: -kv[1][0])[:limit]:
            fam, rest = t.split(":", 1)
            key, val = rest.split("=", 1)
            out.append({"family": fam, "key": key, "value": val, "freq": f, "weight": round(w, 2),
                        "pop": self.N_live if key in LIVE_ONLY else self.N, "live_only": key in LIVE_ONLY,
                        "shared_by": len(who)})
        return out

    def explain(self, cluster: Cluster, focus: str | None = None) -> str:
        """Plain-words evidence: which rare things are shared, and how rare."""
        lines = []
        for ev in self.evidence(cluster):
            lines.append(f"{ev['key'].replace('_', ' ')} '{ev['value']}' appears on only {ev['freq']} of {ev['pop']} "
                         f"{'current ' if ev['live_only'] else ''}deals (shared by {ev['shared_by']} in this group)")
        extras = sorted({x for e in cluster.edges for x in e.extra})
        names = [self.p[m].label for m in cluster.members]
        head = (f"Linked to {len(cluster.members)-1} other deal(s) ({', '.join(f'{m} {n}' if m.startswith('H-') else n for m, n in zip(cluster.members, names) if m != focus)}) "
                f"across {len(cluster.families)} independent evidence families ({', '.join(sorted(cluster.families))}). ")
        return head + "Shared rare attributes: " + "; ".join(lines + extras) + "."


def build_graph(profiles: list[Profile]) -> RingGraph:
    return RingGraph(profiles)
