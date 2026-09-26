-- Until a synthetic prospect is created in the same transaction as its immutable
-- origin, no operator may attach a demo marker to a free-form lead ID. A wrong
-- marker would otherwise suppress real prospect communications permanently.
ALTER TABLE ls_demo.records ADD CONSTRAINT demo_prospect_marker_requires_producer
 CHECK (entity_kind <> 'prospect');
