/*
Fix: convert the BR to Async and pass sys_id
1) Change the Business Rule

In the BR record:

keep When = after

keep Update checked

keep your filter conditions (hhs_id changes AND hhs_id is not empty) (matches your screenshot)

check “Async” (on the Advanced tab)

Then update the script to pass current.getUniqueValue():
*/


(function executeRule(current, previous /*null when async*/) {

    gs.info('PMC***** SM Create BR triggered (async)...');

    // Even though your filter already checks this, keep guards in script.
    if (!current.hhs_id) return;

    // In async BR, previous is null. So don't rely on previous.
    // Instead, use a "already processed" guard.
    if (current.sm_person_handle) return;

    // Pass sys_id string (safe for async)
    new x_g_cfm_vas.VASUtil().createSmPersonPositionCase(current.getUniqueValue());

})(current, previous);



/*
Your current BR is passing the full record (current) into the Script Include. 

BR_to_create_person_position_ca…


That might work, but passing sys_id is the safer / most standard async pattern.
*/


