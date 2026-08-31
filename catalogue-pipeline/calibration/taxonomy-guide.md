# Movie Mood Taxonomy Calibration

**Taxonomy version:** `taxonomy.v2`

This artifact defines Movie Mood's semantic taxonomy for maintainer-side classification. The axes are independent by definition and may correlate in real films. No cross-axis combination is invalid merely because it is unusual; boundary and anomaly signals request review rather than prohibit a record.

## Axes Are Not Shortcuts

- Pace is the perceived movement of scenes, story, and cutting. It is not attention demand.
- Emotional weight is the after-effect and emotional load. It is not mood.
- `relaxing` is a calming experiential mood; `easy-watch` is a practical choice context. A relaxing film can still ask for close attention, and an easy watch can be emotionally busy.
- `light` means limited emotional recovery cost, not low attention demand.
- `fast` means brisk movement, not necessarily exciting.
- `thoughtful` means reflective or idea-rich, not necessarily immersive.

## Moods

### funny

Positive: humor is a material part of the viewing experience, whether dry, playful, absurd, or darkly comic.

Boundary: `funny` can coexist with `heavy`; it does not mean cheerful or consequence-free.

Counterexample: a witty dialogue scene does not make an otherwise straight drama funny.

Anchors: `paddington-2`, `knives-out`, `rye-lane-2023`.

### exciting

Positive: kinetic stakes, action, pursuit, spectacle, or escalating momentum create an energized experience.

Boundary: a fast film can be merely busy; excitement needs felt propulsion or stakes.

Counterexample: `before-sunrise` is conversation-forward rather than exciting despite emotional momentum.

Anchors: `mad-max`, `edge-of-tomorrow`, `rrr`.

### thoughtful

Positive: the film invites reflection through ideas, observation, moral tension, or formal attention.

Boundary: thoughtful is not a synonym for slow, serious, or difficult.

Counterexample: `knives-out` is engaged and clever, but its core invitation is a puzzle rather than reflection.

Anchors: `arrival`, `perfect-days`, `petite-maman-2021`.

### relaxing

Positive: the experience feels gentle, settling, restorative, or low-pressure.

Boundary: relaxation can coexist with moderate attention or a little sadness.

Counterexample: a quiet but harrowing drama is not relaxing.

Anchors: `paddington-2`, `perfect-days`, `my-neighbor-totoro`.

### emotional

Positive: relationships, memory, longing, grief, tenderness, or feeling-forward stakes are central to the experience.

Boundary: emotional does not require `heavy`; warmth and romance can be light.

Counterexample: a tense procedural with an isolated sad beat is not necessarily emotional.

Anchors: `arrival`, `before-sunrise`, `petite-maman-2021`.

### suspenseful

Positive: uncertainty, threat, concealment, or a puzzle creates sustained anticipation.

Boundary: suspense can be playful and need not be grim.

Counterexample: a mystery premise alone is insufficient when its viewing experience is mainly conversational.

Anchors: `knives-out`, `the-game`, `get-out`.

## Viewing Situations

### alone

Positive: especially rewarding as a personal, inward, or self-paced watch.

Boundary: this is a fit signal, not a claim that the film cannot be shared.

Anchors: `perfect-days`, `aftersun`, `arrival`.

### date-night

Positive: offers conversation, romance, chemistry, shared discovery, or a balanced joint experience.

Boundary: romance is not required, and a date-night pick need not be easy.

Anchors: `before-sunrise`, `crouching-tiger`, `knives-out`.

### friends

Positive: communal energy, laughter, tension, spectacle, or discussion makes group viewing rewarding.

Boundary: this is not a quality or popularity label.

Anchors: `grand-budapest`, `knives-out`, `edge-of-tomorrow`.

### family

Positive: the current Movie Mood standard treats it as broadly shareable across ages with manageable intensity, not merely a film containing a family.

Boundary: family may still include mild sadness, peril, or complexity.

Counterexample: a family drama for adults is not automatically `family`.

Anchors: `paddington-2`, `spirited-away`, `my-neighbor-totoro`.

### easy-watch

Positive: low practical friction: approachable setup, manageable cognitive load, and limited emotional recovery cost for the intended use.

Boundary: `easy-watch` differs from `easy` attention and `light` weight; it combines practical fit rather than replacing either axis.

Counterexample: a gentle, slow, puzzle-like film can be relaxing but not an easy watch.

Anchors: `paddington-2`, `perfect-days`, `before-sunrise`.

## Ordered Axes

### pace

- `slow`: patient scene rhythm, observational space, or unhurried plot movement. Contrast `medium`: a calm tone can still move through clear beats. Anchor: `perfect-days`.
- `medium`: neither persistently rushed nor deliberately patient; scene movement has room without sustained drag. Contrast `fast`: a lively premise alone does not make it fast. Anchor: `paddington-2`.
- `fast`: brisk scenes, plotting, cutting, or forward momentum. Contrast `exciting`: speed can serve comedy or talk rather than adrenaline. Anchor: `edge-of-tomorrow`.

### emotionalWeight

- `light`: limited emotional recovery cost, even when the film is thoughtful or attentive. Contrast `moderate`: tenderness or worry may be present without becoming the dominant burden. Anchor: `paddington-2`.
- `moderate`: meaningful feeling or tension with manageable recovery cost. Contrast `heavy`: the film need not leave a sustained emotional burden. Anchor: `arrival`.
- `heavy`: grief, violence, dread, trauma, or sustained consequence materially shapes the after-effect. Contrast `emotional`: a film may be emotional and still light. Anchor: `whiplash`.

### attentionDemand

- `easy`: the film remains legible with low cognitive effort and tolerates casual attention. Contrast `easy-watch`: a practical label may differ where emotional load is high. Anchor: `paddington-2`.
- `engaged`: rewards following dialogue, relationships, or a puzzle but does not require continuous immersion. Contrast `immersive`: missing details should not collapse the experience. Anchor: `knives-out`.
- `immersive`: sustained attention is materially rewarded or expected because of density, formal construction, puzzle structure, or emotional concentration. Contrast `thoughtful`: reflection alone does not require immersive attention. Anchor: `arrival`.

### discoveryStyle

- `familiar`: broadly accessible form, premise, or reference point makes it an easy entry. Contrast `different`: unusual texture can still be approachable. Anchor: `paddington-2`.
- `different`: offers a distinct cultural, tonal, or formal flavor without making novelty its main barrier. Contrast `adventurous`: it remains a reasonable step outside a familiar lane. Anchor: `perfect-days`.
- `adventurous`: challenging, formally bold, culturally distant for the likely audience, or otherwise a more committed leap. Contrast `different`: novelty alone is insufficient. Anchor: `petite-maman-2021`.

## Current Human-Approved Cardinality Distribution

The 41-record V8 catalogue is descriptive calibration data, not a maximum rule.

| Field | One | Two | Three | Four |
| --- | ---: | ---: | ---: | ---: |
| moods | 3 | 33 | 5 | 0 |
| situations | 10 | 20 | 10 | 1 |

Normal cardinality is two moods and one to three situations. One mood/situation and three moods are human-approved; four situations is unusual but human-approved (`truman-show`). The classifier should flag 1 or 3 moods and 1 or 4 situations for review context, not reject them. Values beyond these observed ranges require a review flag, not a hard maximum, unless a future production invariant is explicitly approved.
