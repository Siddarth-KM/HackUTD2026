"""Normalisation + tolerant matching for names, addresses, dates, money.

Matching is deliberately forgiving of benign variation (nicknames, 'Co' vs 'Company', 'Apt' vs 'Unit' wording,
case, punctuation) because every false MISMATCH / ID_MISMATCH costs score. It is strict on the things that
actually identify an entity: numbers, last names, dates of birth.
"""
from __future__ import annotations
import re
from datetime import date, datetime
from typing import Optional
from rapidfuzz import fuzz

_ENTITY_SUFFIX = {"llc", "l", "c", "inc", "incorporated", "corp", "corporation", "co", "company", "pllc", "lp", "llp",
                  "ltd", "limited", "pc", "plc", "group", "the"}
_NICK = {
    "bob": "robert", "rob": "robert", "bobby": "robert", "robbie": "robert", "bill": "william", "will": "william",
    "billy": "william", "jim": "james", "jimmy": "james", "mike": "michael", "mick": "michael", "dick": "richard",
    "rick": "richard", "rich": "richard", "ricky": "richard", "liz": "elizabeth", "beth": "elizabeth", "betty": "elizabeth",
    "lizzie": "elizabeth", "kate": "katherine", "katie": "katherine", "kathy": "katherine", "cathy": "katherine",
    "tom": "thomas", "tommy": "thomas", "tony": "anthony", "dave": "david", "steve": "steven", "stephen": "steven",
    "chris": "christopher", "matt": "matthew", "dan": "daniel", "danny": "daniel", "joe": "joseph", "joey": "joseph",
    "andy": "andrew", "drew": "andrew", "nick": "nicholas", "ben": "benjamin", "sam": "samuel", "alex": "alexander",
    "jen": "jennifer", "jenny": "jennifer", "jess": "jessica", "maggie": "margaret", "peggy": "margaret", "meg": "margaret",
    "pat": "patrick", "ted": "edward", "ed": "edward", "eddie": "edward", "charlie": "charles", "chuck": "charles",
    "hank": "henry", "harry": "henry", "jack": "john", "johnny": "john", "jon": "john", "larry": "lawrence",
    "becky": "rebecca", "sue": "susan", "susie": "susan", "vicky": "victoria", "tim": "timothy", "greg": "gregory",
    "jeff": "jeffrey", "ron": "ronald", "ronnie": "ronald", "don": "donald", "ken": "kenneth", "kenny": "kenneth",
    "sandy": "sandra", "debbie": "deborah", "deb": "deborah", "cindy": "cynthia", "terry": "terrence", "fred": "frederick",
    "gene": "eugene", "gabe": "gabriel", "josh": "joshua", "zach": "zachary", "zack": "zachary", "pete": "peter",
    "phil": "phillip", "ray": "raymond", "al": "albert", "abby": "abigail", "amy": "amelia", "nate": "nathan",
}
_ADDR = {"street": "st", "drive": "dr", "boulevard": "blvd", "avenue": "ave", "road": "rd", "lane": "ln", "parkway": "pkwy",
         "circle": "cir", "court": "ct", "place": "pl", "highway": "hwy", "suite": "ste", "apartment": "apt", "unit": "apt",
         "north": "n", "south": "s", "east": "e", "west": "w", "freeway": "fwy"}


def _tokens(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (s or "").lower().replace("&", " and "))


def norm_entity(name: Optional[str]) -> str:
    """Company name key: lowercase, no punctuation, entity suffixes ('LLC','Co','Company',..) dropped."""
    toks = [t for t in _tokens(name or "") if t not in _ENTITY_SUFFIX]
    return " ".join(toks)


_CREDENTIALS = {"cpa", "ea", "cfp", "cma", "mba", "esq", "jd", "enrolled", "agent", "pc", "pllc"}
_NO_PREPARER = {"self prepared", "selfprepared", "self", "owner", "n a", "none", "nobody", ""}


def norm_preparer(name: Optional[str]) -> str:
    """'Owen Price, CPA' and 'Owen Price' are the same preparer. Self-prepared / owner is NOT a preparer."""
    toks = [t for t in _tokens(name or "") if t not in _CREDENTIALS]
    key = " ".join(toks)
    return "" if key in _NO_PREPARER else key


def entity_match(a: Optional[str], b: Optional[str], dba: Optional[str] = None) -> bool:
    if not a or not b:
        return True  # nothing to compare is not a mismatch
    ka, kb = norm_entity(a), norm_entity(b)
    if ka == kb:
        return True
    if dba and (norm_entity(dba) == kb or norm_entity(dba) == ka):
        return True
    return fuzz.ratio(ka, kb) >= 94  # one-character typos, not different companies


def _canon_first(t: str) -> str:
    return _NICK.get(t, t)


def person_tokens(name: Optional[str]) -> list[str]:
    toks = [t for t in _tokens(name or "") if t not in {"jr", "sr", "ii", "iii", "iv", "mr", "mrs", "ms", "dr"}]
    return toks


def person_match(a: Optional[str], b: Optional[str]) -> bool:
    """Same person? Tolerates nicknames (Bob/Robert), dropped or extra middle names, initials, and 'Last, First'."""
    if not a or not b:
        return True
    ta, tb = person_tokens(a), person_tokens(b)
    if "," in a:
        ta = person_tokens(" ".join(reversed([p for p in a.split(",", 1)])))
    if "," in b:
        tb = person_tokens(" ".join(reversed([p for p in b.split(",", 1)])))
    if not ta or not tb:
        return True
    la, lb = ta[-1], tb[-1]
    if la != lb and fuzz.ratio(la, lb) < 92:
        return False
    fa, fb = _canon_first(ta[0]), _canon_first(tb[0])
    if fa == fb or fa.startswith(fb) and len(fb) == 1 or fb.startswith(fa) and len(fa) == 1:
        return True
    # first name could be the other's middle name ('Maria Elena' vs 'Elena')
    mids_a = {_canon_first(t) for t in ta[:-1]}
    mids_b = {_canon_first(t) for t in tb[:-1]}
    if fa in mids_b or fb in mids_a:
        return True
    return fuzz.ratio(fa, fb) >= 88 and len(fa) > 3


def norm_addr(s: Optional[str]) -> str:
    toks = [_ADDR.get(t, t) for t in _tokens(s or "")]
    return " ".join(t for t in toks if t not in {"tx", "texas", "usa"})


def addr_match(a: Optional[str], b: Optional[str]) -> bool:
    if not a or not b:
        return True
    na, nb = norm_addr(a), norm_addr(b)
    if na == nb:
        return True
    # house number + zip must agree when both present, otherwise it is a different place
    num_a, num_b = re.match(r"\d+", na), re.match(r"\d+", nb)
    if num_a and num_b and num_a.group() != num_b.group():
        return False
    zip_a, zip_b = re.findall(r"\b\d{5}\b", na), re.findall(r"\b\d{5}\b", nb)
    if zip_a and zip_b and zip_a[-1] != zip_b[-1]:
        return False
    return fuzz.token_sort_ratio(na, nb) >= 90


def parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    return date(int(m[1]), int(m[2]), int(m[3])) if m else None


def digits(s: Optional[str]) -> str:
    return re.sub(r"\D", "", s or "")


def norm_ein(s: Optional[str]) -> str:
    d = digits(s)
    return f"{d[:2]}-{d[2:]}" if len(d) == 9 else (s or "").strip()


def money_close(a: Optional[float], b: Optional[float], rel: float = 0.005, abs_tol: float = 1.0) -> bool:
    if a is None or b is None:
        return True
    return abs(a - b) <= max(abs_tol, rel * max(abs(a), abs(b)))
