*** Settings ***
Documentation    Ventas navigation keywords — direct URL routing (no sidebar click dependency)
Library          Browser    timeout=30s    retry_assertions_for=10s

*** Variables ***
${BASE_URL}    https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local
${TIMEOUT}     30s

*** Keywords ***
Navigate To Page
    [Documentation]    Navigate to any app route by hash fragment, e.g. /cpm/geoTerritory
    [Arguments]    ${route}    ${wait_selector}=css=.main-content, .page-content, [class*=container]
    Go To    ${BASE_URL}/#${route}
    Wait Until Keyword Succeeds    ${TIMEOUT}    1s    Current URL Contains    ${route}
    Wait For Elements State    ${wait_selector} >> nth=0    visible    ${TIMEOUT}

Navigate To Geo Hierarchy
    [Documentation]    Navigate to Geo Hierarchy page and wait for tree to load
    Go To    ${BASE_URL}/#/cpm/geoTerritory
    Wait Until Keyword Succeeds    ${TIMEOUT}    1s    Current URL Contains    geoTerritory
    # Wait for all 4 hierarchy nodes: Channel, Distribution Channel, Country, NIGERIA
    Wait Until Keyword Succeeds    ${TIMEOUT}    1s    Loc Data Count Should Be At Least    4

Loc Data Count Should Be At Least
    [Arguments]    ${min}
    ${count}=    Get Element Count    css=.loc-data
    Should Be True    ${count} >= ${min}

Current URL Contains
    [Arguments]    ${fragment}
    ${url}=    Get Url
    Should Contain    ${url}    ${fragment}
