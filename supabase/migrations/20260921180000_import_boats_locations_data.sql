-- Bulk import of real boats/locations data from the Google Sheets export
-- (mainsheet -> config.csv -> boats/locations keys), taken 2026-09-21.
-- Excludes known test/duplicate rows: locations 'test'x2 (both inactive),
-- boats 'Zest 1' inactive duplicate, 'dibby' (category=test, inactive),
-- and 'test' (category=wingfoil, clearly a test artifact).
--
-- Ids are freshly generated uuids (uuid5 over the old Sheets string id,
-- so the mapping is deterministic and reviewable) since the old ids
-- (e.g. loc_mn9kry3s) aren't valid uuids for the new schema. Boats'
-- default_port_id references are resolved through that same mapping.

insert into public.locations (id, name, type, coordinates, active) values
  ('9a0b7ef4-e0cc-5ab7-84e3-104a59e051b4', 'Fossvogur', 'location', '64.1184,-21.9417', true),
  ('d462e5c4-8a53-570a-87f6-7afd7fee23a9', 'Við brúnna', 'location', '64.1187,-21.9384', true),
  ('fe5f41ed-3af2-5158-acf2-cc76194cca15', 'Utan flugbrautar', 'location', '64.1208,-21.9463', true),
  ('b70885ff-a7a7-5c02-aeea-be54166a3a46', 'Skerin', 'location', '64.1307,21.9970', true),
  ('cea91c42-1ccc-5632-b831-2a99538e8d7e', 'Við Sjáland', 'location', '64.0975,-21.9341', true),
  ('f285bfce-99f0-57eb-8295-430f375b319e', 'Við Seltjarnarnes', 'location', '64.1495,-22.0140', true),
  ('f6588fcc-1a18-5d49-b2d8-a267aeedfcf1', 'Við Álftanes', 'location', '64.1191,-21.0566', true),
  ('efd1ff78-6b6c-5ddc-912a-5c7d20a8083f', 'Lambhúsatjörn', 'location', '64.1003,-21.9810', true),
  ('f73d796d-9858-58b7-af92-c1132b80361f', 'Kópavogshöfn', 'location', '64.1125,-21.9420', true),
  ('b01b0bb1-b2f3-5276-aea0-4be1186d18ab', 'Naustavör', 'port', '64.1156,-21.9239', true),
  ('a074a29a-12c3-5ff8-a0f1-89c44935ad41', 'Ingólfsgarður', 'port', '64.1515,-21.9329', true);

insert into public.boats (
  id, name, category, active, oos, oos_reason, default_port_id, registration_no,
  type_model, loa, ownership, owner_kennitala, owner_name, access_mode, access_gate,
  access_gate_cert, access_allowlist, slot_scheduling_enabled, available_outside_slots
) values
  ('e1b00e7b-a5d1-5a44-a9e6-b54fc33056a3', 'Zest 1', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('b709fcda-ab85-55c9-b08a-cc4c050571dc', 'Zest 2', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('b2636ab5-abab-562d-b5c5-fa376496368a', 'Zest 3', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('b843c77a-8168-5323-a10a-7f0f781abeab', 'Zest 4', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('43b016fd-40eb-5d8c-b3d8-acf91f251d17', 'Zest 5', 'dinghy', true, true, 'tiller joint busted. -- SDS ordered new 5/7', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('14c748ff-546d-5ce0-bc74-48bf47affd18', 'Zest 6', 'dinghy', true, true, '3 zest sails are losing/have lost their retention strap on the luff sleeve.', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('15f72153-65d1-584d-b21c-318d3ba08847', 'Quest 1', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('bde9efec-c4bf-5fe4-a4a9-0e6b6e926c92', 'Quest 2', 'dinghy', true, true, 'Centerboard missing; needs resized cotter pin at forestay tensioner', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('8bf63e25-e7ce-552d-a8f3-ceadc290f5a5', 'ILCA 1', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mok1v4ud"}'::jsonb, 'cert_mok1v4ud', '[]'::jsonb, false, true),
  ('798e64d4-0d09-5339-b284-87767c4f66eb', 'ILCA 2', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mok1v4ud"}'::jsonb, 'cert_mok1v4ud', '[]'::jsonb, false, true),
  ('6fde78d4-a319-54f6-9801-07fc23bed584', 'ILCA 3', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mok1v4ud"}'::jsonb, 'cert_mok1v4ud', '[]'::jsonb, false, true),
  ('55c3f157-ea00-5250-9ef3-527c20d76f84', 'ILCA 4', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mok1v4ud"}'::jsonb, 'cert_mok1v4ud', '[]'::jsonb, false, true),
  ('93dfd482-943d-53f7-9259-146fcd85e5c4', 'Topper Topaz 1', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('f22bd0f9-632e-5501-9e29-22450c316785', 'Topper Topaz 2', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('7afbab57-7f66-531e-b035-4e77cf98eba6', 'Topper Topaz 3', 'dinghy', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('5c8df410-1369-51dd-b54b-1b898c280af3', 'Topaz Argo', 'dinghy', true, true, 'Mast broken at foresail rivet point; boom gooseneck snapped; starboard forequart', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('80c927e3-9a5a-596c-9461-425ac2b41666', 'Terhi 1', 'rowboat', true, true, 'Repaired oarlock came loose after first day. Consider epoxy over wood?', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('fceb3086-c274-5e4f-b0bc-dcd92f45cc85', 'Terhi 2', 'rowboat', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('b8c08f71-99e0-5795-98a0-ab5f803ef667', 'Terhi 3', 'rowboat', true, true, 'Oarlock needs epoxy repair & bolt through to hold wood block.', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('9b8a8bfa-b2f8-5d5e-9825-3378c56cdc88', 'Terhi 4', 'rowboat', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('628f53c5-6fda-5d55-a67c-5558bf9cf5cb', 'Carmen', 'keelboat', true, false, '', 'b01b0bb1-b2f3-5276-aea0-4be1186d18ab', '', 'Micro 18', 18, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('3db22a56-004a-57c4-9f13-ca2b1d1f3587', 'Gróa', 'keelboat', true, true, 'Add lifelines (needs drilling for second row)', 'b01b0bb1-b2f3-5276-aea0-4be1186d18ab', '', 'PB 63', 20.77, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('54242b8f-43b1-5578-a4e3-0fd88cdd92b2', 'Yngling', 'keelboat', true, false, '', 'b01b0bb1-b2f3-5276-aea0-4be1186d18ab', '', 'Yngling', 20.83, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('dc9f9a83-9293-5066-b49b-7d9bdec1c68f', 'Sif', 'keelboat', true, false, '', 'a074a29a-12c3-5ff8-a0f1-89c44935ad41', '9836', 'Secret 26', 26, 'club', '', '', 'controlled', NULL, 'captain', '[]'::jsonb, true, true),
  ('d4cf3410-5fbb-546c-b16d-2f44635bd5b0', 'Gulla', 'keelboat', true, false, '', 'a074a29a-12c3-5ff8-a0f1-89c44935ad41', '9838', 'Secret 26', 26, 'club', '', '', 'controlled', NULL, 'captain', '[]'::jsonb, true, true),
  ('17e3e911-2202-5e1f-8f6a-cd656509d394', 'SUP 1', 'sup', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('46e6753f-0981-55d3-8760-5b7bc3d4d709', 'SUP 2', 'sup', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('a24d77aa-1f64-5065-bf46-cb6311a36aa5', 'Paradise 1', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('78b1a014-ea5f-5127-9ec2-ef2e0e552259', 'Paradise 2', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('ab3fd39e-b145-52a5-a212-a6eaa15f9e12', 'Paradise 3', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('8fa6e30b-8ba4-5c8d-af7e-30cf22891773', 'Prijon', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('80fed780-7b75-5cc5-a4f2-9ad4a15e6fb1', 'Calypso 1', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('aa119b08-431b-5a4e-a53b-f6e756e14bb0', 'Calypso 2', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('23c77c9b-1aa9-5dfa-8eb9-c19aec91b949', 'Calypso 3', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('5b1df3e6-3e3e-5310-9d30-d5ee15d2ad06', 'Calypso 4', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('d6d79c09-2b49-51d2-913c-454cf4e8e7c6', 'Striker 1', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('dd90d89b-7fa1-5e8e-8006-626f4d9a3383', 'Striker 2', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('1934d367-a372-56a9-8020-67dff4cf537a', 'Orange 1', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('4b5e34af-af67-5ea4-8a9d-627fff101fc6', 'Orange 2', 'kayak', true, false, '', NULL, '', '', NULL, 'club', '', '', 'free', NULL, '', '[]'::jsonb, false, true),
  ('9f5330cf-080c-5b2f-b7a9-33033813a7af', 'Pramminn', 'support-boat', true, false, '', NULL, '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mnuhq6w5"}'::jsonb, 'cert_mnuhq6w5', '[]'::jsonb, false, true),
  ('f9feb568-413b-53d8-a7a3-3f2a7008a06c', 'Rigiflex', 'support-boat', true, false, '', NULL, '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mnuhq6w5"}'::jsonb, 'cert_mnuhq6w5', '[]'::jsonb, false, true),
  ('4078b3ef-ef0d-545d-b12b-0eac4235ed95', 'Steady', 'support-boat', true, false, '', NULL, '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mnuhq6w5"}'::jsonb, 'cert_mnuhq6w5', '[]'::jsonb, false, true),
  ('18fbbc4a-bb0f-5c37-9865-82c7f09ecba5', 'Vogun', 'rowing-shell', true, false, '', 'b01b0bb1-b2f3-5276-aea0-4be1186d18ab', '', '', NULL, 'club', '', '', 'controlled', NULL, 'released_rower', '[]'::jsonb, true, false),
  ('c275bc9b-a1aa-5e31-b4cb-083e88345fcd', 'Optimist 1', 'dinghy', true, false, '', 'b01b0bb1-b2f3-5276-aea0-4be1186d18ab', '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mok1v4ud"}'::jsonb, 'cert_mok1v4ud', '[]'::jsonb, false, true),
  ('2e52ca0b-8f85-55b0-94f0-aeede4aa9843', 'Optimist 2', 'dinghy', true, false, '', 'b01b0bb1-b2f3-5276-aea0-4be1186d18ab', '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mok1v4ud"}'::jsonb, 'cert_mok1v4ud', '[]'::jsonb, false, true),
  ('ce5c4a2b-06ab-520c-a736-b2813b3d7ec7', 'Optimist 3', 'dinghy', true, false, '', 'b01b0bb1-b2f3-5276-aea0-4be1186d18ab', '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mok1v4ud"}'::jsonb, 'cert_mok1v4ud', '[]'::jsonb, false, true),
  ('2816fc54-8eba-5154-9093-bddf0b292524', 'Optimist 4', 'dinghy', true, false, '', 'b01b0bb1-b2f3-5276-aea0-4be1186d18ab', '', '', NULL, 'club', '', '', 'controlled', '{"certId": "cert_mok1v4ud"}'::jsonb, 'cert_mok1v4ud', '[]'::jsonb, false, true);
