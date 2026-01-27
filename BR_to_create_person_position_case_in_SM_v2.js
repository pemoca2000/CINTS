(function executeRule(current, previous /*null when async*/) {

    // ============================================================
    // PURPOSE
    // ------------------------------------------------------------
    // Trigger: Applicant.hhs_id transitions from empty -> populated.
    // Action: Call Script Include to create Person/Position/Case in SM
    //         via SmsStdCreatePersParmCase SOAP function.
    // ============================================================

    // --- Safety check: only run if hhs_id is populated now ---
    if (!current.hhs_id) {
        return;
    }

    // --- Trigger rule: run ONLY when hhs_id changes from empty -> value ---
    // previous may be null in async scenarios; for normal after-update BR it exists.
    if (previous && previous.hhs_id && (previous.hhs_id.toString() === current.hhs_id.toString())) {
        // hhs_id didn't change
        return;
    }
    if (previous && previous.hhs_id) {
        // hhs_id was already populated before; you said you want "when empty field is populated"
        return;
    }

    // --- Optional: if we already have a person handle, skip to avoid duplicates ---
    // (You can remove this if you want re-sends.)
    if (current.sm_person_handle) {
        return;
    }

    // Call Script Include to do the real work
    new x_g_cfm_vas.SMIntegration().createPersonPositionCaseFromApplicant(current);

})(current, previous);
