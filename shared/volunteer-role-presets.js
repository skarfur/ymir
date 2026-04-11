// ══ VOLUNTEER ROLE PRESETS ════════════════════════════════════════════════════
// Pre-populated standard volunteer roles for sailing/rowing clubs. Admins can
// pull from these when defining roles on a volunteer activity type or event,
// or create their own from scratch.
//
// Each preset has:
//   id                 — stable preset identifier (not persisted as role id;
//                        the role gets its own unique id on insertion)
//   name, nameIS       — bilingual title
//   description        — bilingual description shown to members on signup
//   descriptionIS
//   slots              — suggested default slot count
//   endorsementHint    — free-text hint about what endorsement typically
//                        applies. Empty for roles that rarely need one.
//                        The admin still picks the actual endorsement from
//                        their club's credential list after inserting.
//
// These presets never reference specific cert def ids because those are
// club-specific. requiredEndorsement is always left empty on insert so the
// admin can wire it up to their own credentials.

(function(global) {
  'use strict';

  var VOLUNTEER_ROLE_PRESETS = [
    {
      id: 'landkrabbi',
      name: 'Landkrabbi',
      nameIS: 'Landkrabbi',
      description: 'Welcome & assist members at the house and with launching their boats. Ensure the ramp is clear and trolleys are accessible. Clean up & close the house at the end of the event.',
      descriptionIS: ' ? ? ? ',
      slots: 1,
      endorsementHint: '',
    },
    {
      id: 'support-boat-skipper',
      name: 'Support boat skipper',
      nameIS: 'Gæslubátsstjóri',
      description: 'Operates the safety / rescue boat during on-water activities and responds to incidents.',
      descriptionIS: 'Stjórnar öryggis- eða björgunarbát á meðan á viðburði stendur og bregst við atvikum.',
      slots: 1,
      endorsementHint: 'Support boat skipper',
    },
    {
      id: 'race-officer',
      name: 'Race officer',
      nameIS: 'Keppnisstjóri',
      description: 'Runs race starts and finishes, manages the course and handles scoring.',
      descriptionIS: 'Sér um ræsingar og endamörk, stýrir brautinni og skráir úrslit.',
      slots: 1,
      endorsementHint: '',
    },
    {
      id: 'committee-boat-crew',
      name: 'Committee boat crew',
      nameIS: 'Keppnisbátsáhöfn',
      description: 'Assists the race committee on the committee boat during races.',
      descriptionIS: 'Aðstoðar dómnefnd á dómarabát á meðan á keppni stendur.',
      slots: 2,
      endorsementHint: '',
    },
    {
      id: 'registration',
      name: 'Registration & check-in',
      nameIS: 'Skráning og innritun',
      description: 'Welcomes participants, checks them in and hands out bibs, numbers or name tags.',
      descriptionIS: 'Tekur á móti þátttakendum, skráir þá inn og afhendir númer eða merkimiða.',
      slots: 2,
      endorsementHint: '',
    },
    {
      id: 'food-refreshments',
      name: 'Food & refreshments',
      nameIS: 'Veitingarstjóri',
      description: 'Prepares and serves food and drinks for participants and guests.',
      descriptionIS: 'Útbýr og ber fram veitingar fyrir þátttakendur og gesti.',
      slots: 2,
      endorsementHint: '',
    },
    {
      id: 'setup-crew',
      name: 'Setup crew',
      nameIS: 'Uppsetning',
      description: 'Pre-event setup — signage, tables, marks, ropes and equipment.',
      descriptionIS: 'Undirbúningur fyrir viðburð — skilti, borð, merki, reipi og búnaður.',
      slots: 3,
      endorsementHint: '',
    },
    {
      id: 'cleanup-crew',
      name: 'Cleanup crew',
      nameIS: 'Frágangur',
      description: 'Post-event cleanup — takedown, rubbish, returning equipment to storage.',
      descriptionIS: 'Frágangur eftir viðburð — taka niður, sorp og skila búnaði í geymslu.',
      slots: 3,
      endorsementHint: '',
    },
    {
      id: 'photographer',
      name: 'Photographer',
      nameIS: 'Ljósmyndari',
      description: 'Captures photos and/or video of the event for the club.',
      descriptionIS: 'Tekur myndir og/eða myndband af viðburðinum fyrir félagið.',
      slots: 1,
      endorsementHint: '',
    },
  ];

  // Returns a shallow copy of the presets sorted by localised name for the
  // given language ('IS' or 'EN'). Consumers should use this rather than
  // mutating the canonical array.
  function listVolunteerRolePresets(lang) {
    var isIS = lang === 'IS';
    return VOLUNTEER_ROLE_PRESETS.slice().sort(function(a, b) {
      var la = (isIS && a.nameIS ? a.nameIS : a.name) || '';
      var lb = (isIS && b.nameIS ? b.nameIS : b.name) || '';
      return la.localeCompare(lb, isIS ? 'is' : 'en', { sensitivity: 'base' });
    });
  }

  // Look up a preset by its stable id. Returns null if not found.
  function getVolunteerRolePreset(id) {
    if (!id) return null;
    for (var i = 0; i < VOLUNTEER_ROLE_PRESETS.length; i++) {
      if (VOLUNTEER_ROLE_PRESETS[i].id === id) return VOLUNTEER_ROLE_PRESETS[i];
    }
    return null;
  }

  global.VOLUNTEER_ROLE_PRESETS    = VOLUNTEER_ROLE_PRESETS;
  global.listVolunteerRolePresets  = listVolunteerRolePresets;
  global.getVolunteerRolePreset    = getVolunteerRolePreset;
})(typeof window !== 'undefined' ? window : this);
