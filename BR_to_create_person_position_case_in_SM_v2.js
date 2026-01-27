(function executeRule(current, previous /*null when async*/) {

    // ============================================================
    // PURPOSE
    // ------------------------------------------------------------
    // Applicant BR: When hhs_id goes from empty -> populated,
    // call Script Include to create Person/Position/Case in SM.
    // ============================================================

    // Only run if hhs_id is populated now
    if (!current.hhs_id) return;

    // Run only on transition: empty -> populated
    if (previous && previous.hhs_id) return; // was already populated before

    // Optional: avoid duplicate create if person handle already exists
    if (current.sm_person_handle) return;

    // Call existing Script Include (VASUtil)
    new x_g_cfm_vas.VASUtil().createPersonPositionCaseFromApplicant(current);

})(current, previous);
