# Test call — script for the other person

Send this whole file to whoever is playing the prospect. They only need the **bold lines**;
everything else is for you.

You play yourself, selling **Vextria HVAC**. They play **Dave**, owner of a small HVAC shop —
50s, practical, money-driven, not a tech guy. Interested, but pushes back like a real owner.

---

## The one rule for them

**Say one sentence. Then stop and stay quiet for two seconds.**

The coach fires when it hears them stop. Running two thoughts together, or trailing off, is the
only way to make this test look worse than it is. Tell them: finish the line, then shut up and
let you read.

---

## Before you start

1. Pick **Vextria HVAC** in the playbook dropdown, and **create a new client** so the Client
   Brain starts empty.
2. Once the call opens, **check the header** — it now shows which playbook is live. If it says
   anything other than Vextria HVAC, stop and fix it. That's the bug that was shipping wrong
   products.
3. Do **one throwaway call first**. The first request of a session runs ~2.5s; every one after
   is ~1.2s. Don't judge speed on the cold one.

---

## Part 1 — the numbers (do not skip, this is the main thing being tested)

> **"Yeah, we're a small shop. Me and two techs, mostly AC replacement around the valley."**

> **"Probably forty, forty-five calls a week. More in the summer."**

> **"Average job is about nine grand, give or take."**

**Watch for:** within about a second the card should come back having *already done the maths* —
"about a hundred and eighty a month", "around forty-eight calls", "even two closing is eighteen
thousand walking out". If you see those numbers, the whole feature works. If the coach instead
asks *"what's one job worth to you?"*, it's ignoring the calculation — tell me.

---

## Part 2 — the price (tests the guard fix)

> **"Alright. So how much is this even gonna run me?"**

**You say, out loud, exactly:** "Setup is four thousand one time, then seven ninety-seven a month."

**Watch for:** the card should keep going normally. That exact phrasing used to be read as the
number 4001, get flagged as unsourced, and the card would blank at the worst possible moment.

> **"Four grand? That's a lot right now."**

**Watch for:** it should anchor against the alternative — a receptionist at two to four thousand
a month — not just ask you another question.

---

## Part 3 — fast back-to-back (tests the stale-card fix)

Have them fire these **two in a row, only a beat apart** — barely time for a card to land:

> **"My customers are mostly older folks, they'll hate talking to a robot."**

> **"And what happens when it quotes somebody wrong and I lose that job? That's my name on the truck."**

**Watch for:** the card that lands must answer the **second** one. Until today the coach would
still be answering the robot objection while Dave had moved on. If you see it reply about older
folks after he's asked about the wrong quote, that's the old bug and I need to know.

---

## Part 4 — similar objections in a row (tests the repetition fix)

Four pushbacks that all invite the same lazy "Totally fair" opener:

> **"Honestly we already have an answering service, so I don't see why I'd pay more."**

> **"My buddy said he saw something like this for around three hundred a month."**

> **"I've been burned before. Paid an agency six months and got nothing."**

> **"I don't know, man. Let me think about it. Maybe run it by my brother."**

**Watch for:** no two cards in a row should open the same way. One "Totally fair" across the
whole call is normal speech; four in a row is the bug.

---

## Part 5 — the close

> **"Okay. That's not bad. What would we actually need to do to get started?"**

> **"And how fast could you get it running?"**

**Watch for:** it should actually ask for something concrete — the date, getting you live this
week — not just another clever question.

---

## Tell them NOT to ask these

Not bugs. The coach is built to stay quiet rather than invent, which is right on a real call and
looks broken in a test.

| Don't ask | Why |
|---|---|
| "Who else uses this? Any customers I can call?" | No clients yet — it won't invent one |
| "What uptime do you guarantee?" | No sourced figure exists |
| "Can you do two grand?" | Floor is $3,500, and only in trade |
| Two questions in one breath | It answers the last thing it heard |

---

## After the call — the five-second check

Open the call in **Calls** and look at:

- **Latency** on the cards — should be around 1.2–1.5s, not 2.5s+
- **One card per thing Dave said** — not three cards answering the same objection
- **Did you actually use any lines?** Mark them. Two of your 134 cards have ever been rated,
  which is why the coach still can't learn what closes for you.
