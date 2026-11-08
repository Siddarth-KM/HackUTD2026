"""Cross-deal graph rules on hand-built profiles (so each rule is tested in isolation)."""
from collections import Counter
from backend.fraud.features import Profile
from backend.fraud.graph import RingGraph


def prof(pid, kind="live", tokens=(), guarantor="", vendor="", **meta):
    p = Profile(pid, kind, pid)
    for t in tokens:
        p.tokens[t] = t.split(":", 1)[0]
    p.meta.update(guarantor=guarantor, vendor=vendor, **meta)
    return p


def corpus(n):
    """n honest history deals, each with its own unremarkable tokens (so nothing common is 'rare')."""
    return [prof(f"H-{i:03d}", "history", [f"provenance:producer=tool{i % 9}", f"people:preparer=prep{i % 7}", f"numeric:round_deposit_share=0-10"])
            for i in range(n)]


RARE = ["provenance:producer=novapdf studio 12", "numeric:round_deposit_share=90-100"]


def members(ids, tokens=RARE):
    return [prof(i, tokens=tokens) for i in ids]


def test_one_pair_sharing_two_rare_things_is_not_enough():
    g = RingGraph(corpus(100) + members(["A", "B"]))
    assert g.clusters() == []                              # 2 families but score ~7.8 < 8: could be coincidence


def test_three_deals_all_sharing_the_same_rare_things_is_a_tight_group():
    g = RingGraph(corpus(100) + members(["A", "B", "C"]))
    cl = g.clusters()
    assert [c.members for c in cl] == [["A", "B", "C"]]
    assert len(cl[0].families) >= 2


def test_one_rare_attribute_alone_never_links_even_for_many_deals():
    g = RingGraph(corpus(100) + members(["A", "B", "C", "D"], tokens=[RARE[0]]))
    assert g.clusters() == []                              # a single family: one shared PDF tool is not a ring


def test_honest_deal_sharing_one_attribute_is_left_out_of_the_group():
    g = RingGraph(corpus(100) + members(["A", "B", "C"]) + members(["COIN"], tokens=[RARE[0]]))
    assert "COIN" not in {m for c in g.clusters() for m in c.members}


def test_common_attributes_carry_no_weight():
    common = ["people:agent=lone star registered agents inc", "provenance:producer=adobe pdf library 17.0"]
    base = corpus(100)
    for p in base[:60]:
        for t in common:
            p.tokens[t] = t.split(":")[0]
    g = RingGraph(base + members(["A", "B", "C"], tokens=common))
    assert g.clusters() == []


# ------------------------------------------------------------------ conclusive single-attribute conflicts
def test_same_id_number_under_two_different_names_links_on_its_own():
    dl = "people:dl=41872219"
    g = RingGraph(corpus(100) + [prof("A", tokens=[dl], guarantor="Maria Alvarado"), prof("B", tokens=[dl], guarantor="Daniel Cruz")])
    cl = g.clusters()
    assert [c.members for c in cl] == [["A", "B"]]
    assert "ID number" in g.explain(cl[0], "A")


def test_same_id_number_same_person_is_a_repeat_borrower_not_a_conflict():
    dl = "people:dl=41872219"
    g = RingGraph(corpus(100) + [prof("A", tokens=[dl], guarantor="Maria Elena Alvarado"), prof("B", tokens=[dl], guarantor="Maria Alvarado")])
    assert g.clusters() == []


def test_nickname_is_not_an_identity_conflict():
    dl = "people:dl=09337120"
    g = RingGraph(corpus(100) + [prof("A", tokens=[dl], guarantor="Bob Kline"), prof("B", tokens=[dl], guarantor="Robert Allen Kline")])
    assert g.clusters() == []


def test_one_remit_account_under_two_vendor_names_links_on_its_own():
    r = "money:remit_full=111924381|4471"
    g = RingGraph(corpus(100) + [prof("A", tokens=[r], vendor="Northgate Machinery LLC"), prof("B", tokens=[r], vendor="Cedar Industrial Supply Inc.")])
    assert [c.members for c in g.clusters()] == [["A", "B"]]
    same = RingGraph(corpus(100) + [prof("A", tokens=[r], vendor="Metroplex Equipment Supply, Inc."), prof("B", tokens=[r], vendor="Metroplex Equipment Supply LLC")])
    assert same.clusters() == []                           # the same vendor reusing its own account is normal


def test_copied_ledger_links_two_live_deals():
    ledger = Counter({(round(1000 + i * 37.5, 2), f"ACH CREDIT INV-#"): 1 for i in range(20)})
    a, b, c = prof("A"), prof("B"), prof("C")
    a.txn_sig, b.txn_sig = Counter(ledger), Counter(ledger)
    c.txn_sig = Counter({(round(5.31 + i, 2), "BRANCH DEPOSIT"): 1 for i in range(20)})
    g = RingGraph(corpus(100) + [a, b, c])
    assert [x.members for x in g.clusters()] == [["A", "B"]]


def test_money_flowing_between_applicants_links_them():
    a, b = prof("A"), prof("B")
    a.own_names, b.own_names = {"mesa bakery"}, {"cedar roofing"}
    a.label, b.label = "Mesa Bakery LLC", "Cedar Roofing LLC"
    a.counterparties = {"WIRE IN CEDAR ROOFING LLC", "PAYROLL ADP WAGE PAY"}
    g = RingGraph(corpus(100) + [a, b])
    cl = g.clusters()
    assert [c.members for c in cl] == [["A", "B"]] and "circular funding" in g.explain(cl[0])


# ------------------------------------------------------------------ live-only attributes are judged against live deals
def test_live_only_attribute_is_not_artificially_rare_while_few_deals_have_arrived():
    # history never records PDF 'creator', so with 8 live deals a creator shared by 2 must NOT look like 1-in-270
    live = [prof(f"L{i}", tokens=["provenance:creator=docuforge templates"] if i < 2 else []) for i in range(8)]
    g = RingGraph(corpus(260) + live)
    assert g.weight("provenance:creator=docuforge templates") < 3.0
