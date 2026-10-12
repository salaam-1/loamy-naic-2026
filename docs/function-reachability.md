# Function reachability

_Generated 2026-09-21 by `npm run reachability`. Do not edit by hand._

Classified by DEPENDENCY GRAPH, not by grant. An earlier version of this
report counted every client-granted function that `src/` did not call as a
missing feature, which badly overstated the gap: `loamy_trace_scope` and
friends are helpers that `loamy_trace` calls, and `loamy_trace` is wired.

## Classification

| Class | Meaning | Count |
|---|---|---:|
| A | user-facing | 106 |
| B | admin-facing | 59 |
| C | internal helper | 64 |
| D | trigger/event | 41 |
| E | scheduled/background | 3 |
| F | deprecated | 8 |
| | **total defined** | **281** |

Only **category A with no caller** is a product gap. Everything else is
either already reachable, deliberately internal, or not client-invoked at all.

## The real gap

**14 user-facing functions have no route in the product.**

- `loamy_accept_task` — last defined in `20260920140002_loamy_block5_gp_workflow.sql`
- `loamy_bank_portfolio_intelligence` — last defined in `20260920160003_loamy_block7_quality_dashboards.sql`
- `loamy_bank_set_status` — last defined in `20260718130002_loamy_stage6_audit_wiring.sql`
- `loamy_decline_task` — last defined in `20260920140002_loamy_block5_gp_workflow.sql`
- `loamy_inferred_preferences` — last defined in `20260920120001_loamy_block3_discovery_events.sql`
- `loamy_link_bank_account` — last defined in `20260919240001_loamy_phase6_financing.sql`
- `loamy_my_verification_cases` — last defined in `20260919270001_loamy_hardening_bvn_anonymity_fees_recon.sql`
- `loamy_open_dispute` — last defined in `20260919160001_loamy_phase5_transactions.sql`
- `loamy_request_listing_verification` — last defined in `20260919150001_loamy_phase4_marketplace_batches.sql`
- `loamy_request_storage` — last defined in `20260919180001_loamy_phase9_warehouse.sql`
- `loamy_respond_to_review` — last defined in `20260920100002_loamy_block1_ratings_reviews.sql`
- `loamy_seller_signals` — last defined in `20260920120003_loamy_block3_discovery_engine.sql`
- `loamy_submit_intelligence_feedback` — last defined in `20260920160003_loamy_block7_quality_dashboards.sql`
- `loamy_submit_verification_case` — last defined in `20260919140002_loamy_phase3_guard_and_expected_location.sql`

## Dynamic call sites

- `src/components/ContactReveal.tsx: .rpc(spec.fn,`

## A — user-facing (106)

- `loamy_accept_task` — **no caller — product gap**
- `loamy_add_company_member` — called from `src/lib/companies.ts`
- `loamy_add_role` — called from `src/lib/userRoles.ts`
- `loamy_admin_log_export` — called from `src/lib/csv.ts`
- `loamy_apply_financing_for_transaction` — called from `src/pages/marketplace/FinancingApply.tsx`
- `loamy_available_tasks` — called from `src/pages/partner/FieldOps.tsx`
- `loamy_award_bids` — called from `src/lib/awards.ts`
- `loamy_bank_portfolio_intelligence` — **no caller — product gap**
- `loamy_bank_set_status` — **no caller — product gap**
- `loamy_can_review` — called from `src/components/ReviewDialog.tsx`
- `loamy_cancel_order` — called from `src/lib/orders.ts`
- `loamy_cancel_rfq` — called from `src/lib/rfqs.ts`
- `loamy_check_my_referrals` — called from `src/pages/shared/InviteBenefits.tsx`
- `loamy_checkout_cart` — called from `src/lib/checkout.ts`
- `loamy_claim_inspection` — called from `src/lib/inspections.ts`
- `loamy_claim_task` — called from `src/pages/partner/FieldOps.tsx`
- `loamy_claim_verification_task` — called from `src/pages/partner/VerificationTasks.tsx`
- `loamy_close_rfq` — called from `src/lib/rfqs.ts`
- `loamy_company_can_settle` — called from `src/lib/escrow.ts`
- `loamy_company_role` — called from `src/lib/companies.ts`
- `loamy_copilot_price_context` — called from `src/lib/copilot/retrieval.ts`
- `loamy_create_batch_from_harvest` — called from `src/lib/stock.ts`
- `loamy_create_company` — called from `src/lib/companies.ts`
- `loamy_decline_task` — **no caller — product gap**
- `loamy_disclose_supplier_contact` — called from `src/lib/awards.ts`
- `loamy_discover_supply` — called from `src/pages/marketplace/Discover.tsx`
- `loamy_financing_decision` — called from `src/lib/bankDecision.ts`
- `loamy_financing_partners` — called from `src/pages/marketplace/FinancingApply.tsx`
- `loamy_get_booking_contacts` — called from `src/components/ContactReveal.tsx`
- `loamy_get_interest_contacts` — called from `src/components/ContactReveal.tsx`
- `loamy_gp_performance` — called from `src/pages/partner/FieldOps.tsx`
- `loamy_gp_set_availability` — called from `src/pages/partner/FieldOps.tsx`
- `loamy_inferred_preferences` — **no caller — product gap**
- `loamy_link_bank_account` — **no caller — product gap**
- `loamy_list_batch` — called from `src/lib/stock.ts`
- `loamy_log_my_event` — called from `src/pages/farmer/FinancingApply.tsx`
- `loamy_logistics_estimate` — called from `src/pages/marketplace/Discover.tsx`
- `loamy_mark_role_onboarded` — called from `src/lib/userRoles.ts`
- `loamy_my_commission_summary` — called from `src/pages/partner/FieldOps.tsx`
- `loamy_my_financial_activity` — called from `src/pages/shared/FinancialActivity.tsx`
- `loamy_my_referral_summary` — called from `src/pages/shared/InviteBenefits.tsx`
- `loamy_my_tasks` — called from `src/lib/home.ts`, `src/pages/partner/FieldOps.tsx`
- `loamy_my_verification_cases` — **no caller — product gap**
- `loamy_open_dispute` — **no caller — product gap**
- `loamy_open_ticket` — called from `src/pages/shared/Support.tsx`
- `loamy_partner_funnel` — called from `src/pages/partner/GrowthPartnerOverview.tsx`
- `loamy_partner_territory` — called from `src/pages/partner/GrowthPartnerOverview.tsx`
- `loamy_place_orders_from_cart` — called from `src/lib/orders.ts`
- `loamy_profile_by_username` — called from `src/pages/public/PublicProfile.tsx`
- `loamy_profile_reviews` — called from `src/pages/public/PublicProfile.tsx`
- `loamy_propose_transaction` — called from `src/lib/checkout.ts`
- `loamy_publish_rfq` — called from `src/lib/rfqs.ts`
- `loamy_rating_summary` — called from `src/pages/public/PublicProfile.tsx`
- `loamy_record_discovery_event` — called from `src/lib/useDiscoveryEvents.ts`
- `loamy_record_marketplace_settlement` — called from `src/components/RecordSettlement.tsx`
- `loamy_record_referral` — called from `src/pages/Onboarding.tsx`, `src/pages/partner/OnboardFarmer.tsx`
- `loamy_redeem_benefit` — called from `src/pages/shared/InviteBenefits.tsx`
- `loamy_release_order` — called from `src/lib/payments.ts`
- `loamy_remove_company_member` — called from `src/lib/companies.ts`
- `loamy_request_farm_verification_guarded` — called from `src/pages/farmer/FarmDetail.tsx`
- `loamy_request_inspection` — called from `src/lib/inspections.ts`
- `loamy_request_listing_verification` — **no caller — product gap**
- `loamy_request_storage` — **no caller — product gap**
- `loamy_request_transport` — called from `src/lib/logistics.ts`
- `loamy_request_transport_for_transaction` — called from `src/pages/marketplace/PurchaseDetail.tsx`
- `loamy_request_withdrawal` — called from `src/lib/wallet.ts`
- `loamy_reserve_warehouse` — called from `src/lib/logistics.ts`
- `loamy_resolve_fee` — called from `src/lib/fees.ts`
- `loamy_respond_reservation` — called from `src/lib/logistics.ts`
- `loamy_respond_to_order` — called from `src/lib/orders.ts`
- `loamy_respond_to_review` — **no caller — product gap**
- `loamy_review_ambassador_price` — called from `src/lib/ambassador.ts`
- `loamy_review_inspection` — called from `src/lib/inspections.ts`
- `loamy_role_intelligence` — called from `src/pages/shared/MarketIntelligence.tsx`
- `loamy_select_transport_offer` — called from `src/lib/logistics.ts`
- `loamy_seller_signals` — **no caller — product gap**
- `loamy_set_initial_role` — called from `src/lib/userRoles.ts`
- `loamy_set_payout_account` — called from `src/components/PayoutAccountCard.tsx`
- `loamy_set_username` — called from `src/components/UsernameCard.tsx`
- `loamy_settlement_readiness` — called from `src/pages/marketplace/PurchaseDetail.tsx`
- `loamy_sign_contract` — called from `src/lib/contracts.ts`
- `loamy_submit_ambassador_price` — called from `src/lib/ambassador.ts`
- `loamy_submit_bid` — called from `src/lib/bids.ts`
- `loamy_submit_checklist` — called from `src/pages/partner/TaskDetail.tsx`
- `loamy_submit_evidence` — called from `src/lib/evidenceUpload.ts`
- `loamy_submit_inspection` — called from `src/lib/inspections.ts`
- `loamy_submit_intelligence_feedback` — **no caller — product gap**
- `loamy_submit_review` — called from `src/components/ReviewDialog.tsx`
- `loamy_submit_transport_offer` — called from `src/lib/logistics.ts`
- `loamy_submit_verification_case` — **no caller — product gap**
- `loamy_suggest_warehouses` — called from `src/pages/marketplace/PurchaseDetail.tsx`
- `loamy_supplier_contact` — called from `src/lib/awards.ts`
- `loamy_switch_role` — called from `src/lib/userRoles.ts`
- `loamy_task_detail` — called from `src/pages/admin/AdminVerificationQueue.tsx`, `src/pages/partner/TaskDetail.tsx`
- `loamy_task_farm_info` — called from `src/pages/admin/AdminVerificationQueue.tsx`, `src/pages/partner/TaskDetail.tsx` +1
- `loamy_ticket_reply` — called from `src/pages/admin/AdminSupport.tsx`, `src/pages/shared/Support.tsx`
- `loamy_trace` — called from `src/pages/trace/TraceExplorer.tsx`
- `loamy_transaction_journey` — called from `src/pages/marketplace/PurchaseDetail.tsx`
- `loamy_transaction_transition` — called from `src/pages/marketplace/PurchaseDetail.tsx`
- `loamy_unlist_batch` — called from `src/lib/stock.ts`
- `loamy_update_company` — called from `src/lib/companies.ts`
- `loamy_update_company_member_role` — called from `src/lib/companies.ts`
- `loamy_update_task_progress` — called from `src/pages/partner/TaskDetail.tsx`
- `loamy_update_transport_status` — called from `src/lib/logistics.ts`
- `loamy_username_available` — called from `src/components/UsernameCard.tsx`
- `loamy_withdraw_bid` — called from `src/lib/bids.ts`

## B — admin-facing (59)

- `loamy_activate_facility` — called from `src/pages/bank/BankLoans.tsx`
- `loamy_admin_moderate_listing` — called from `src/pages/admin/AdminListingsOversight.tsx`
- `loamy_admin_resolve_ticket` — called from `src/pages/admin/AdminSupport.tsx`
- `loamy_admin_set_role` — called from `src/pages/admin/AdminUsers.tsx`
- `loamy_admin_set_user_active` — called from `src/pages/admin/AdminUsers.tsx`
- `loamy_admin_stats` — called from `src/pages/admin/AdminHome.tsx`
- `loamy_admin_user_summary` — called from `src/pages/admin/AdminUsers.tsx`
- `loamy_announce` — called from `src/pages/admin/AdminAnnouncements.tsx`
- `loamy_application_bundle` — called from `src/pages/bank/BankApplicationDetail.tsx`
- `loamy_assign_transport` — not client-invoked
- `loamy_assign_verification_task` — not client-invoked
- `loamy_assignment_candidates` — not client-invoked
- `loamy_bank_pipeline` — called from `src/pages/bank/BankHome.tsx`, `src/pages/bank/BankLoans.tsx` +2
- `loamy_bank_portfolio` — called from `src/pages/bank/BankHome.tsx`, `src/pages/bank/BankRiskCompliance.tsx`
- `loamy_case_role` — not client-invoked
- `loamy_commission_transition` — not client-invoked
- `loamy_conversion_funnel` — not client-invoked
- `loamy_create_task` — not client-invoked
- `loamy_dispute_verification` — not client-invoked
- `loamy_eligibility_signal` — not client-invoked
- `loamy_escrow_transition` — not client-invoked
- `loamy_generate_credit_report` — called from `src/pages/bank/BankApplicationDetail.tsx`
- `loamy_gp_set_suspension` — not client-invoked
- `loamy_gp_set_training` — not client-invoked
- `loamy_hide_review` — not client-invoked
- `loamy_institutional_production` — not client-invoked
- `loamy_institutional_storage` — not client-invoked
- `loamy_institutional_trace` — not client-invoked
- `loamy_institutional_trade` — not client-invoked
- `loamy_invalidate_referral` — not client-invoked
- `loamy_ledger_balance` — not client-invoked
- `loamy_logistics_transition` — not client-invoked
- `loamy_mark_overdue_repayments` — called from `src/pages/bank/BankAlerts.tsx`, `src/pages/bank/BankHome.tsx` +3
- `loamy_model_inventory` — not client-invoked
- `loamy_open_escrow` — not client-invoked
- `loamy_platform_metrics` — called from `src/pages/admin/AdminHome.tsx`, `src/pages/admin/AdminPaymentsSettlements.tsx`
- `loamy_publish_task` — not client-invoked
- `loamy_reassign_task` — not client-invoked
- `loamy_record_disbursement` — called from `src/pages/bank/BankFacilityDetail.tsx`
- `loamy_record_intelligence` — not client-invoked
- `loamy_record_loading` — not client-invoked
- `loamy_record_repayment` — called from `src/pages/bank/BankFacilityDetail.tsx`, `src/pages/bank/BankRepayments.tsx`
- `loamy_record_repayment_status` — not client-invoked
- `loamy_record_supplier_settlement` — not client-invoked
- `loamy_record_warehouse_receipt` — not client-invoked
- `loamy_record_weather` — not client-invoked
- `loamy_request_financing_verification` — not client-invoked
- `loamy_resolve_data_quality` — not client-invoked
- `loamy_respond_storage` — not client-invoked
- `loamy_review_verification_case` — called from `src/pages/admin/AdminVerificationQueue.tsx`
- `loamy_risk_assessment` — called from `src/pages/bank/BankApplicationDetail.tsx`
- `loamy_sandbox_bank_decision` — not client-invoked
- `loamy_set_bank_officer_active` — called from `src/pages/admin/AdminBankOfficers.tsx`
- `loamy_set_can_verify` — called from `src/pages/admin/AdminPartners.tsx`
- `loamy_set_task_expiry` — not client-invoked
- `loamy_setup_bank_officer` — called from `src/pages/admin/AdminBankOfficers.tsx`
- `loamy_trace_agent_chain` — not client-invoked
- `loamy_trace_identity` — not client-invoked
- `loamy_upsert_referral_programme` — not client-invoked

## C — internal helper (64)

- `loamy_accrue_commission` — called by `loamy_commission_on_approval`
- `loamy_accrue_earning_internal` — called by `loamy_record_referral`, `loamy_review_verification_task`
- `loamy_active_referral_programme` — called by `loamy_my_referral_code`, `loamy_attribute_referral`
- `loamy_attribute_referral` — called by `loamy_record_referral`
- `loamy_audit_internal` — called by `loamy_set_can_verify`, `loamy_review_verification_task`
- `loamy_bank_capabilities` — called by `loamy_financing_partners`
- `loamy_batch_financing_commitment` — called by `loamy_apply_financing_for_transaction`, `loamy_settlement_readiness`
- `loamy_batch_transition` — called by `loamy_review_verification_case`, `loamy_list_batch`
- `loamy_can_bid_on` — called by `loamy_submit_bid`
- `loamy_can_manage_transport` — called by `loamy_select_transport_offer`
- `loamy_can_report_prices` — called by `loamy_submit_ambassador_price`
- `loamy_can_verify` — called by `loamy_request_farm_verification`, `loamy_record_referral`
- `loamy_case_expected_point` — called by `loamy_submit_evidence`
- `loamy_checklist_for` — called by `loamy_publish_task`, `loamy_task_detail`
- `loamy_company_can_admin` — called by `loamy_update_company`, `loamy_add_company_member`
- `loamy_company_can_inspect` — called by `loamy_submit_inspection`
- `loamy_company_can_procure` — called by `loamy_publish_rfq`, `loamy_close_rfq`
- `loamy_covers_farm` — called by `loamy_claim_verification_task`, `loamy_task_farm_info`
- `loamy_covers_location` — called by `loamy_claim_inspection`
- `loamy_create_notification` — not client-invoked
- `loamy_create_notification_internal` — called by `loamy_request_farm_verification`, `loamy_set_can_verify`
- `loamy_demand_signal` — called by `loamy_role_intelligence`
- `loamy_evidence_weight` — called by `loamy_demand_signal`
- `loamy_fee_from_snapshot` — called by `loamy_escrow_transition`
- `loamy_financing_permitted_decisions` — called by `loamy_application_bundle`
- `loamy_geojson_area_hectares` — called by `loamy_farm_sync_mapped_area`
- `loamy_gp_can_take` — called by `loamy_assignment_candidates`, `loamy_claim_task`
- `loamy_guard_active_actor` — called by `loamy_request_farm_verification_guarded`
- `loamy_has_institutional_scope` — called by `loamy_institutional_production`, `loamy_institutional_trade`
- `loamy_haversine_m` — called by `loamy_gps_check`, `loamy_submit_evidence`
- `loamy_interest_counterparty` — called by `loamy_interest_guard`, `loamy_interest_notify`
- `loamy_is_active` — called by `loamy_guard_active_actor`, `loamy_set_username`
- `loamy_is_admin` — called by `loamy_set_can_verify`, `loamy_assign_verification_task`
- `loamy_is_role` — called by `loamy_submit_transport_offer`
- `loamy_is_supplier_role` — called by `loamy_can_bid_on`
- `loamy_ledger_append_internal` — called by `loamy_record_disbursement`, `loamy_record_repayment`
- `loamy_log_institutional_query` — called by `loamy_institutional_production`, `loamy_institutional_trade`
- `loamy_member_account` — called by `loamy_escrow_transition`, `loamy_commission_transition`
- `loamy_min_group_size` — called by `loamy_demand_signal`, `loamy_supply_signal`
- `loamy_my_referral_code` — called by `loamy_my_referral_summary`
- `loamy_next_ref` — called by `loamy_register_ref`, `loamy_assign_ref`
- `loamy_normalize_role` — called by `loamy_sync_platform_role`
- `loamy_officer_bank` — called by `loamy_bank_set_status`, `loamy_application_bundle`
- `loamy_post_ledger` — called by `loamy_escrow_transition`, `loamy_record_supplier_settlement`
- `loamy_price_comparison` — called by `loamy_discover_supply`
- `loamy_price_history` — called by `loamy_role_intelligence`
- `loamy_qualify_referral` — called by `loamy_check_my_referrals`, `loamy_referral_on_profile_complete`
- `loamy_record_kyc_result` — not client-invoked
- `loamy_reference_price` — called by `loamy_price_comparison`
- `loamy_referral_qualifies` — called by `loamy_qualify_referral`, `loamy_my_referral_summary`
- `loamy_register_ref` — called by `loamy_record_observation`, `loamy_upsert_referral_programme`
- `loamy_repeated_coordinates` — called by `loamy_submit_evidence`
- `loamy_request_farm_verification` — called by `loamy_request_farm_verification_guarded`
- `loamy_seasonal_pattern` — called by `loamy_role_intelligence`
- `loamy_strip_rapid_completion_from_evidence` — not client-invoked
- `loamy_supply_signal` — called by `loamy_role_intelligence`
- `loamy_trace_batch` — called by `loamy_trace`
- `loamy_trace_batch_for_ref` — called by `loamy_trace`
- `loamy_trace_financing` — called by `loamy_trace`
- `loamy_trace_loading` — called by `loamy_trace`
- `loamy_trace_resolve` — called by `loamy_trace_batch_for_ref`
- `loamy_trace_scope` — called by `loamy_trace_batch`, `loamy_trace_financing`
- `loamy_unit_kg` — called by `loamy_reference_price`, `loamy_price_comparison`
- `loamy_user_company_ids` — called by `loamy_can_bid_on`, `loamy_supplier_contact`

## D — trigger/event (41)

- `loamy_assign_ref` — not client-invoked
- `loamy_audit_app_transition` — not client-invoked
- `loamy_audit_config_change` — not client-invoked
- `loamy_audit_price_entry` — not client-invoked
- `loamy_benefit_guard` — not client-invoked
- `loamy_booking_guard` — not client-invoked
- `loamy_booking_notify` — not client-invoked
- `loamy_booking_set_service_type` — not client-invoked
- `loamy_buy_request_notify` — not client-invoked
- `loamy_cart_touch` — not client-invoked
- `loamy_commission_guard` — not client-invoked
- `loamy_commission_on_approval` — not client-invoked
- `loamy_discovery_event_guard` — not client-invoked
- `loamy_dq_guard` — not client-invoked
- `loamy_farm_sync_mapped_area` — not client-invoked
- `loamy_feedback_actor` — not client-invoked
- `loamy_financing_default_bank` — not client-invoked
- `loamy_financing_status_history` — not client-invoked
- `loamy_gp_ops_guard` — not client-invoked
- `loamy_intelligence_guard` — not client-invoked
- `loamy_interest_guard` — not client-invoked
- `loamy_interest_notify` — not client-invoked
- `loamy_loading_guard` — not client-invoked
- `loamy_protect_can_verify` — not client-invoked
- `loamy_protect_can_verify_insert` — not client-invoked
- `loamy_protect_facility_verification` — not client-invoked
- `loamy_protect_farm_status` — not client-invoked
- `loamy_protect_financing_decision` — not client-invoked
- `loamy_protect_listing_batch` — not client-invoked
- `loamy_protect_platform_role` — not client-invoked
- `loamy_protect_profile_badge` — not client-invoked
- `loamy_record_held_role` — not client-invoked
- `loamy_referral_guard` — not client-invoked
- `loamy_referral_on_profile_complete` — not client-invoked
- `loamy_review_guard` — not client-invoked
- `loamy_set_updated_at` — not client-invoked
- `loamy_snapshot_transaction_fee` — not client-invoked
- `loamy_sync_platform_role` — not client-invoked
- `loamy_task_guard` — not client-invoked
- `loamy_task_notify_submit` — not client-invoked
- `loamy_username_guard` — not client-invoked

## E — scheduled/background (3)

- `loamy_expire_tasks` — not client-invoked
- `loamy_run_data_quality` — not client-invoked
- `loamy_run_reconciliation` — not client-invoked

## F — deprecated (8)

- `loamy_contract_from_award` — not client-invoked
- `loamy_evidence_guard` — not client-invoked
- `loamy_flag_rapid_completion` — not client-invoked
- `loamy_gps_check` — Superseded by loamy_submit_evidence (P0-3). Wrote a distance into a JSON blob; the replacement writes a real verification_evidence row with a content hash, clock skew and the fraud checks.
- `loamy_record_observation` — called by `loamy_review_verification_case`
- `loamy_review_verification_task` — Superseded by loamy_review_verification_case (P0-2). Admin-gated but carried no separation-of-duties check.
- `loamy_supersede_evidence` — not client-invoked
- `loamy_wallet_balance` — Superseded by loamy_my_financial_activity (P0-1). Implied Loamy holds member funds.
