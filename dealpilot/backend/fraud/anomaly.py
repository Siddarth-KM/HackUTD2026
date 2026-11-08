"""ML watch-score: IsolationForest trained on the year of history that carries no known-trick label.

Why unsupervised: the hidden set uses a trick we have never seen, and history holds only 2 examples of the new
one, so a supervised classifier would just relearn the OLD rules we already have exactly.

How it is used: a deal that is statistically unusual vs the bank's normal book gets a watch score + the features
that make it unusual (shown to the credit officer and in the memo). It is NEVER a hold trigger on its own:
Tyler's messy startup and James's international firm are legitimately unusual, and blocking them is a mistake
the brief explicitly counts. It becomes evidence only when combined with cross-deal linkage.
"""
from __future__ import annotations
import numpy as np
from .features import Profile

FEATURES = ["log_amount", "amount_to_rev", "log_revenue", "age_years", "round_share", "deposit_count",
            "deposit_cv", "deposits_to_rev", "term"]


class AnomalyModel:
    def __init__(self):
        self.model = None
        self.mu = self.sd = None
        self.train_scores = None

    def _x(self, profiles: list[Profile]) -> np.ndarray:
        return np.array([[p.stats.get(f, 0.0) for f in FEATURES] for p in profiles], dtype=float)

    def fit(self, history: list[Profile], labels_ok=lambda p: p.meta.get("fraud_label") in (None, "none", "")):
        from sklearn.ensemble import IsolationForest
        base = [p for p in history if p.stats and labels_ok(p)]
        if len(base) < 30:
            return self
        X = self._x(base)
        self.mu, self.sd = X.mean(0), X.std(0) + 1e-9
        self.model = IsolationForest(n_estimators=300, contamination="auto", random_state=7).fit((X - self.mu) / self.sd)
        self.train_scores = np.sort(-self.model.score_samples((X - self.mu) / self.sd))
        return self

    def score(self, p: Profile) -> dict:
        if self.model is None or not p.stats:
            return {}
        x = self._x([p])
        z = (x - self.mu) / self.sd
        raw = float(-self.model.score_samples(z)[0])
        pct = float(np.searchsorted(self.train_scores, raw) / len(self.train_scores))
        order = np.argsort(-np.abs(z[0]))[:3]
        top = [{"feature": FEATURES[i], "z": round(float(z[0][i]), 2)} for i in order if abs(z[0][i]) >= 1.5]
        return {"percentile": round(pct, 3), "unusual": pct >= 0.98, "top": top}
