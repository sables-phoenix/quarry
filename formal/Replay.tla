---- MODULE Replay ----
EXTENDS Naturals, FiniteSets

CONSTANTS Steps, Asserts, TrueAsserts

VARIABLES phase, observed, acted, pending, cropTried, budget

vars == <<phase, observed, acted, pending, cropTried, budget>>

Init ==
  /\ phase = "idle"
  /\ observed = 0
  /\ acted = {}
  /\ pending = Asserts
  /\ cropTried = FALSE
  /\ budget = 0

Start ==
  /\ phase = "idle"
  /\ phase' = "observing"
  /\ UNCHANGED <<observed, acted, pending, cropTried, budget>>

Observe(n) ==
  /\ phase \in {"observing", "acting"}
  /\ n \in 0..3
  /\ n > observed
  /\ (n <= 1 \/ (n = 2 /\ observed >= 1) \/ (n = 3 /\ cropTried))
  /\ observed' = n
  /\ budget' = budget + 1
  /\ cropTried' = (cropTried \/ n >= 2)
  /\ UNCHANGED <<phase, acted, pending>>

BeginAct ==
  /\ phase = "observing"
  /\ observed >= 1
  /\ phase' = "acting"
  /\ UNCHANGED <<observed, acted, pending, cropTried, budget>>

Act(s) ==
  /\ phase = "acting"
  /\ s \in Steps \ acted
  /\ acted' = acted \cup {s}
  /\ UNCHANGED <<phase, observed, pending, cropTried, budget>>

FinishAct ==
  /\ phase = "acting"
  /\ acted = Steps
  /\ phase' = "verifying"
  /\ UNCHANGED <<observed, acted, pending, cropTried, budget>>

Assert(a) ==
  /\ phase = "verifying"
  /\ a \in pending
  /\ a \in TrueAsserts
  /\ pending' = pending \ {a}
  /\ UNCHANGED <<phase, observed, acted, cropTried, budget>>

Fail ==
  /\ phase = "verifying"
  /\ \E a \in pending : a \notin TrueAsserts
  /\ phase' = "failed"
  /\ UNCHANGED <<observed, acted, pending, cropTried, budget>>

Pass ==
  /\ phase = "verifying"
  /\ pending = {}
  /\ phase' = "passed"
  /\ UNCHANGED <<observed, acted, pending, cropTried, budget>>

Next ==
  \/ Start
  \/ \E n \in 0..3 : Observe(n)
  \/ BeginAct
  \/ \E s \in Steps : Act(s)
  \/ FinishAct
  \/ \E a \in Asserts : Assert(a)
  \/ Fail
  \/ Pass

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

PassedOnlyWhenAllAsserted == phase = "passed" => pending = {}
CropBeforeFull == observed = 3 => cropTried
BudgetBound == budget <= 4
FailedMeansAnAssertionIsFalse ==
  phase = "failed" => \E a \in pending : a \notin TrueAsserts
Terminated == phase \in {"passed", "failed"}
====
