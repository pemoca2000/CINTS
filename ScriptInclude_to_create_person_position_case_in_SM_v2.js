var SMIntegration = Class.create();
SMIntegration.prototype = {
    initialize: function () {},

    /**
     * Entry point called by the Applicant Business Rule.
     *
     * @param {GlideRecord} applicantGR - record from x_g_cfm_vas_applicant (BR "current")
     * @returns {Object} result - { ok: boolean, httpStatus: number, handles: {...}, body?: string }
     */
    createPersonPositionCaseFromApplicant: function (applicantGR) {

        // ------------------------------------------------------------
        // 1) Find the related Case record (x_g_cfm_vas_case)
        // ------------------------------------------------------------
        // Your sample case XML shows a field called <applicant/> on the case record,
        // which we assume is a reference to x_g_cfm_vas_applicant. :contentReference[oaicite:6]{index=6}
        //
        // If your field name differs, change it in _getCaseForApplicant().
        var caseGR = this._getCaseForApplicant(applicantGR);
        if (!caseGR) {
            // Nothing to send; log and exit safely
            gs.warn('[SMIntegration] No case found for applicant ' + applicantGR.getUniqueValue());
            return { ok: false, httpStatus: 0, error: 'No related case found.' };
        }

        // ------------------------------------------------------------
        // 2) Build the SOAP message
        // ------------------------------------------------------------
        var soap = new sn_ws.SOAPMessageV2(
            'x_g_cfm_vas.VAS SM Outbound',      // SOAP Message record name
            'SmsStdCreatePersParmCase'          // SOAP Message Function name
        );

        // ------------------------------------------------------------
        // 3) Authentication handling
        // ------------------------------------------------------------
        // Your updated info says you have a Basic Auth profile record:
        // sys_auth_profile_basic.name = "VAS SM Dev Basic Auth Creds" :contentReference[oaicite:7]{index=7}
        //
        // If SM expects HTTP Basic Auth at the transport layer, this is correct:
        this._applyHttpBasicAuthProfile(soap);

        // IMPORTANT:
        // Your originally generated script sets SOAP header params:
        // AuthHeader.UserName / AuthHeader.Password :contentReference[oaicite:8]{index=8}
        //
        // If SM requires those values *inside* the SOAP header (not just HTTP basic),
        // you should store them in sys_properties and set them here. (Avoid hardcoding.)
        //
        // Example:
        // soap.setStringParameterNoEscape('AuthHeader.UserName', gs.getProperty('x_g_cfm_vas.sm.soap_user'));
        // soap.setStringParameterNoEscape('AuthHeader.Password', gs.getProperty('x_g_cfm_vas.sm.soap_pass'));

        // ------------------------------------------------------------
        // 4) Create payload mapping (SN fields -> SOAP params)
        // ------------------------------------------------------------
        // This is where we handle:
        // - mismatched names (SN field != SOAP param)
        // - choice translations (tier_4 -> T4, etc.)
        var payload = this._buildCreatePayload(caseGR, applicantGR);

        // Apply all mapped params to SOAP request
        this._applyParams(soap, payload);

        // ------------------------------------------------------------
        // 5) Execute SOAP call
        // ------------------------------------------------------------
        var response, status, body;
        try {
            response = soap.execute();
            status = response.getStatusCode();
            body = response.getBody();
        } catch (ex) {
            gs.error('[SMIntegration] SOAP execute() threw exception: ' + ex.message);
            return { ok: false, httpStatus: 0, error: ex.message };
        }

        if (status < 200 || status > 299) {
            this._logFailure(applicantGR, caseGR, status, body);
            return { ok: false, httpStatus: status, body: body };
        }

        // ------------------------------------------------------------
        // 6) Parse response handles
        // ------------------------------------------------------------
        // Response contains:
        // PersonResponse/personHandle
        // PositionResponse/positionHandle
        // CaseResponse/caseHandle :contentReference[oaicite:9]{index=9}
        var handles = this._parseHandles(body);

        // Validate handles are present
        if (!handles.personHandle || !handles.positionHandle || !handles.caseHandle) {
            gs.error('[SMIntegration] SOAP succeeded but missing one or more handles. Applicant='
                + applicantGR.getUniqueValue() + ' Case=' + caseGR.getUniqueValue());
            gs.error('[SMIntegration] Response body: ' + body);
            return { ok: false, httpStatus: status, body: body, handles: handles };
        }

        // ------------------------------------------------------------
        // 7) Persist handles back into ServiceNow
        // ------------------------------------------------------------
        this._writeHandles(applicantGR, caseGR, handles);

        gs.info('[SMIntegration] Created SM records successfully. Applicant='
            + applicantGR.getUniqueValue() + ' Case=' + caseGR.getUniqueValue()
            + ' personHandle=' + handles.personHandle
            + ' positionHandle=' + handles.positionHandle
            + ' caseHandle=' + handles.caseHandle
        );

        return { ok: true, httpStatus: status, handles: handles };
    },

    /**
     * Returns the "best" case for the applicant.
     * CURRENT BEHAVIOR: choose most recently created case.
     *
     * If your business rules require "open case only" or something else,
     * we can add additional query filters here.
     */
    _getCaseForApplicant: function (applicantGR) {
        var c = new GlideRecord('x_g_cfm_vas_case');

        // Assumption based on your sample XML: case has a field named "applicant" referencing applicant table. :contentReference[oaicite:10]{index=10}
        // If field name differs, change 'applicant' below.
        c.addQuery('applicant', applicantGR.getUniqueValue());

        // Optional: only grab cases that don't already have handles
        c.addNullQuery('sm_case_handle');
        c.addNullQuery('sm_position_handle');

        c.orderByDesc('sys_created_on');
        c.setLimit(1);
        c.query();

        if (c.next()) return c;
        return null;
    },

    /**
     * Apply HTTP Basic Auth profile to the SOAP request using the profile name
     * "VAS SM Dev Basic Auth Creds". :contentReference[oaicite:11]{index=11}
     */
    _applyHttpBasicAuthProfile: function (soap) {
        var profileSysId = this._getBasicAuthProfileSysId('VAS SM Dev Basic Auth Creds');
        if (!profileSysId) {
            gs.warn('[SMIntegration] Basic auth profile not found: VAS SM Dev Basic Auth Creds');
            return;
        }
        // authentication type is 'basic' for sys_auth_profile_basic
        soap.setAuthenticationProfile('basic', profileSysId);
    },

    /**
     * Look up sys_auth_profile_basic by name and return sys_id.
     */
    _getBasicAuthProfileSysId: function (profileName) {
        var p = new GlideRecord('sys_auth_profile_basic');
        p.addQuery('name', profileName);
        p.setLimit(1);
        p.query();
        if (p.next()) return p.getUniqueValue();
        return '';
    },

    /**
     * Builds a dictionary where:
     *   key   = SOAP parameter name
     *   value = string value to send
     *
     * Parameter list is based on your generated “working” example. :contentReference[oaicite:12]{index=12}
     * Field names come from your sample case/applicant XML. :contentReference[oaicite:13]{index=13}
     */
    _buildCreatePayload: function (caseGR, applicantGR) {
        // Helper to safely read field values even if you’re not sure the field exists
        // (prevents runtime errors if a field is missing in a given environment).
        function getVal(gr, fieldName) {
            if (!gr || !gr.isValidField(fieldName)) return '';
            return (gr.getValue(fieldName) || '').toString();
        }

        // Translate investigation basis from SN choice values -> SM expected values.
        // Your note: investigation_basis_requested can be "tier_4" etc. :contentReference[oaicite:14]{index=14}
        var tierMap = {
            'tier_1': 'T1',
            'tier_2': 'T2',
            'tier_3': 'T3',
            'tier_4': 'T4',
            'tier_5': 'T5'
        };
        function mapTier(v) {
            if (!v) return '';
            return tierMap[v] || v; // fallback: send original if unknown
        }

        // Convert booleans to Yes/No strings if SM expects that
        function yesNo(v) {
            // v might be "true"/"false", "1"/"0", etc.
            if (v === true || v === 'true' || v === '1') return 'Yes';
            return 'No';
        }

        // Choose best email source for PersonParams.email
        // Applicant has agency_email, work_email, personal_address in sample. :contentReference[oaicite:15]{index=15}
        var personEmail =
            getVal(applicantGR, 'agency_email') ||
            getVal(applicantGR, 'work_email') ||
            getVal(applicantGR, 'personal_address');

        // Build payload based on your tested SOAP params list :contentReference[oaicite:16]{index=16}
        return {
            // ---------------------------
            // CaseParams
            // ---------------------------
            'CaseParams.caseStatus': getVal(caseGR, 'case_status'),
            'CaseParams.dateApplicantSignature': getVal(caseGR, 'date_of_applicants_signature'),
            'CaseParams.investigationBasisRequested': mapTier(getVal(caseGR, 'investigation_basis_requested')),
            'CaseParams.datePaperworkReceived': getVal(caseGR, 'date_received'),

            // Priority mapping: your test used "None". :contentReference[oaicite:17]{index=17}
            // If you have a dedicated field, map that instead.
            'CaseParams.casePriorityLevel': getVal(caseGR, 'case_priority_level') || 'None',

            // pivRequested: test used "Yes". :contentReference[oaicite:18]{index=18}
            // Your sample case has badge_requested (looks like a boolean-ish field). :contentReference[oaicite:19]{index=19}
            'CaseParams.pivRequested': yesNo(getVal(caseGR, 'badge_requested')),

            // caseType: test used "Suitability". :contentReference[oaicite:20]{index=20}
            // If you have a real field, swap it in; else keep default.
            'CaseParams.caseType': getVal(caseGR, 'case_type') || 'Suitability',

            // requestingUserEmail: test used an email value. :contentReference[oaicite:21]{index=21}
            // Often this is the requester/submitter email; we’ll use applicant agency_email as a default.
            'CaseParams.requestingUserEmail': getVal(applicantGR, 'agency_email'),

            // ---------------------------
            // PositionParams
            // ---------------------------
            'PositionParams.positionSensitivity': getVal(caseGR, 'position_sensitivity'),
            'PositionParams.positionTitle': getVal(caseGR, 'position_title'),
            'PositionParams.employeeType': getVal(caseGR, 'employee_type') || 'CONTRACTOR',
            'PositionParams.employeeStatus': getVal(applicantGR, 'employee_status') || 'active',

            // organization: your test used "CMS". :contentReference[oaicite:22]{index=22}
            // If you have an organization field, map it here.
            'PositionParams.organization': getVal(caseGR, 'organization') || 'CMS',

            // ---------------------------
            // contractInfo (you noted it is part of PositionParams) :contentReference[oaicite:23]{index=23}
            // ---------------------------
            'contractInfo.contractorName': getVal(caseGR, 'contractor_company'),
            'contractInfo.activeStatus': 'Active',
            'contractInfo.contractNumber': getVal(caseGR, 'contract_name') || getVal(caseGR, 'contract'),
            'contractInfo.contractStartDate': getVal(caseGR, 'contract_start_date') || getVal(applicantGR, 'contract_start_date'),
            'contractInfo.contractEndDate': getVal(caseGR, 'contract_end_date') || getVal(applicantGR, 'contract_end_date'),

            // ---------------------------
            // PersonParams (from applicant)
            // ---------------------------
            'PersonParams.firstName': getVal(applicantGR, 'legal_first_name'),
            'PersonParams.middleName': getVal(applicantGR, 'middle_name'),
            'PersonParams.lastName': getVal(applicantGR, 'legal_last_name'),
            'PersonParams.email': personEmail,

            'PersonParams.birthCity': getVal(applicantGR, 'birth_city'),
            'PersonParams.birthState': getVal(applicantGR, 'birth_state'),
            'PersonParams.birthCountry': getVal(applicantGR, 'birth_country'),
            'PersonParams.citizenshipCountry': getVal(applicantGR, 'citizenship_country'),

            // birthDate/ssn fields are not shown in your sample applicant XML,
            // but your SOAP function expects them in your tested script. :contentReference[oaicite:24]{index=24}
            // If they exist in the table, this will populate them; otherwise it will send blank.
            'PersonParams.birthDate': getVal(applicantGR, 'birth_date'),
            'PersonParams.ssn': getVal(applicantGR, 'ssn'),

            // isSsnNotAvailable: default false if not present
            'PersonParams.isSsnNotAvailable': getVal(applicantGR, 'is_ssn_not_available') || 'false'
        };
    },

    /**
     * Apply each key/value as a SOAP parameter.
     * We use setStringParameterNoEscape because ServiceNow generated code used that.
     */
    _applyParams: function (soapMsg, payloadObj) {
        for (var key in payloadObj) {
            if (payloadObj.hasOwnProperty(key)) {
                soapMsg.setStringParameterNoEscape(key, payloadObj[key]);
            }
        }
    },

    /**
     * Parse the 3 handles from the SM SOAP response.
     * Uses local-name() XPath so XML namespaces won't break the query. :contentReference[oaicite:25]{index=25}
     */
    _parseHandles: function (responseXml) {
        var out = { personHandle: '', positionHandle: '', caseHandle: '' };

        var xml = new XMLDocument2();
        xml.parseXML(responseXml);

        out.personHandle = (xml.getNodeText("//*[local-name()='PersonResponse']/*[local-name()='personHandle']") || '').trim();
        out.positionHandle = (xml.getNodeText("//*[local-name()='PositionResponse']/*[local-name()='positionHandle']") || '').trim();
        out.caseHandle = (xml.getNodeText("//*[local-name()='CaseResponse']/*[local-name()='caseHandle']") || '').trim();

        return out;
    },

    /**
     * Persist handles back into ServiceNow:
     * - applicant.sm_person_handle
     * - case.sm_position_handle
     * - case.sm_case_handle :contentReference[oaicite:26]{index=26}
     *
     * We call setWorkflow(false) to reduce risk of triggering other workflows/BRs.
     * (This doesn’t magically prevent all BRs, but it’s a common safety step.)
     */
    _writeHandles: function (applicantGR, caseGR, handles) {
        // Update Applicant
        applicantGR.setWorkflow(false);
        applicantGR.sm_person_handle = handles.personHandle;
        applicantGR.update();

        // Update Case
        caseGR.setWorkflow(false);
        caseGR.sm_position_handle = handles.positionHandle;
        caseGR.sm_case_handle = handles.caseHandle;
        caseGR.update();
    },

    _logFailure: function (applicantGR, caseGR, status, body) {
        gs.error('[SMIntegration] SM create failed. HTTP ' + status
            + ' Applicant=' + applicantGR.getUniqueValue()
            + ' Case=' + caseGR.getUniqueValue());
        gs.error('[SMIntegration] Response: ' + body);
    },

    type: 'SMIntegration'
};
