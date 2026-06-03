*** Settings ***
Documentation    TC-AIR-007: Geo Hierarchy Displays Channel And Country Panels
...              Verify that after navigating to Geo Hierarchy (/#/cpm/geoTerritory),
...              the page displays the hierarchy tree with Channel and country nodes
...              including Distribution Channel and NIGERIA entries.
Library          Browser    timeout=30s    retry_assertions_for=10s

*** Variables ***
${BASE_URL}             https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local
${GEO_TERRITORY_URL}    ${BASE_URL}/#/cpm/geoTerritory
${TC_USERNAME}          %{TC_USERNAME}
${TC_PASSWORD}          %{TC_PASSWORD}
${USERNAME_FIELD}       css=#username
${PASSWORD_FIELD}       css=#password
${LOGIN_BTN}            css=#kc-login
${TIMEOUT}              30s

*** Test Cases ***
Verify Geo Hierarchy Displays Channel And Country Panels
    [Documentation]    Verify the Geo Hierarchy page displays the hierarchy tree
    ...                with Channel, Distribution Channel, and NIGERIA nodes
    [Tags]    Hierarchy    UI    automation    TC-AIR-007
    [Setup]    Open Test Session
    [Teardown]    Close Test Session

    Login To Application
    Navigate To Geo Hierarchy Page
    Verify Hierarchy Tree Loaded
    Verify Channel Node Is Visible
    Verify Distribution Channel Node Is Visible
    Verify Nigeria Node Is Visible

*** Keywords ***
Open Test Session
    New Browser    chromium    headless=False
    New Context    ignoreHTTPSErrors=True    recordVideo={'dir': '${OUTPUTDIR}', 'size': {'width': 1280, 'height': 720}}
    New Page       ${BASE_URL}
    Wait For Elements State    ${USERNAME_FIELD}    visible    ${TIMEOUT}

Close Test Session
    Close Browser

Login To Application
    Click             ${USERNAME_FIELD}
    Keyboard Input    type    ${TC_USERNAME}
    Wait For Elements State    ${LOGIN_BTN}    enabled    ${TIMEOUT}
    Click             ${LOGIN_BTN}
    Wait For Elements State    ${PASSWORD_FIELD}    visible    ${TIMEOUT}
    Click             ${PASSWORD_FIELD}
    Keyboard Input    type    ${TC_PASSWORD}    delay=50ms
    Wait For Elements State    ${LOGIN_BTN}    enabled    ${TIMEOUT}
    Click             ${LOGIN_BTN}
    Wait Until Keyword Succeeds    ${TIMEOUT}    1s    URL Should Contain    myProfile

Navigate To Geo Hierarchy Page
    Go To    ${GEO_TERRITORY_URL}
    Wait Until Keyword Succeeds    ${TIMEOUT}    1s    URL Should Contain    geoTerritory
    # Use nth=0 to avoid strict mode violation — 4 .loc-data nodes exist on this page
    Wait For Elements State    css=.loc-data >> nth=0    visible    ${TIMEOUT}

Verify Hierarchy Tree Loaded
    ${count}=    Get Element Count    css=.loc-data
    Should Be True    ${count} > 0    Expected hierarchy tree entries to be present

Verify Channel Node Is Visible
    # loc-data nth=0 → "Channel" (confirmed: getByText('ChannelChannel'))
    Wait For Elements State    css=.loc-data >> nth=0    visible    ${TIMEOUT}
    ${text}=    Get Text    css=.loc-data >> nth=0
    Should Contain    ${text}    Channel

Verify Distribution Channel Node Is Visible
    # loc-data nth=1 → "Distribution Channel" (confirmed: getByText('Distribution ChannelDistribution Channel Active'))
    Wait For Elements State    css=.loc-data >> nth=1    visible    ${TIMEOUT}
    ${text}=    Get Text    css=.loc-data >> nth=1
    Should Contain    ${text}    Distribution Channel

Verify Nigeria Node Is Visible
    # loc-data nth=3 → "NIGERIA" (confirmed: getByText('NIGERIANIGERIA Active'))
    Wait For Elements State    css=.loc-data >> nth=3    visible    ${TIMEOUT}
    ${text}=    Get Text    css=.loc-data >> nth=3
    Should Contain    ${text}    NIGERIA

URL Should Contain
    [Arguments]    ${expected}
    ${url}=    Get Url
    Should Contain    ${url}    ${expected}
