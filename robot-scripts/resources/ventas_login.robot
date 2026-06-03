*** Settings ***
Documentation    Ventas login and session keywords (Keycloak two-step flow)
Library          Browser    timeout=30s    retry_assertions_for=10s

*** Variables ***
${BASE_URL}    https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local
${TIMEOUT}     30s

*** Keywords ***
Open Test Session
    [Documentation]    Open browser with video recording to OUTPUTDIR
    New Browser    chromium    headless=False
    New Context    ignoreHTTPSErrors=True    recordVideo={'dir': '${OUTPUTDIR}', 'size': {'width': 1280, 'height': 720}}
    New Page       ${BASE_URL}
    Wait For Elements State    css=#username    visible    ${TIMEOUT}

Close Test Session
    Close Browser

Login To Application
    [Documentation]    Two-step Keycloak login.
    ...                Step 1: Fill username → Click Login → password field appears.
    ...                Step 2: Click password field → Keyboard Input type (raw key events required) → Click Login.
    ...                Fill Text works for username. Only password needs Keyboard Input type.
    ...                Credentials read from ${TC_USERNAME} / ${TC_PASSWORD} RF variables (set by runner).
    Wait For Elements State    css=#username    visible    30s
    Fill Text    css=#username    ${TC_USERNAME}
    Click        css=#kc-login
    Wait For Elements State    css=#password    visible    15s
    Click        css=#password
    Keyboard Input    type    ${TC_PASSWORD}
    Wait For Elements State    css=#kc-login    enabled    10s
    Click        css=#kc-login
    Wait Until Keyword Succeeds    30s    2s    URL Should Contain    myProfile

URL Should Contain
    [Arguments]    ${fragment}
    ${url}=    Get Url
    Should Contain    ${url}    ${fragment}
