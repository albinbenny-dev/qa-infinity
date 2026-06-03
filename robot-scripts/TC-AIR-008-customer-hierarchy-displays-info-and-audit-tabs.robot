*** Settings ***
Documentation    TC-AIR-008: Customer Hierarchy Displays Info And Audit Tabs
...              Verify that after navigating to Customer Hierarchy (/#/cpm/organizationHierarchy),
...              the page displays both the Info tab and the Audit tab buttons.
Library          Browser    timeout=30s    retry_assertions_for=10s
Resource         resources/ventas_login.robot

*** Variables ***
${BASE_URL}                  https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local
${CUSTOMER_HIERARCHY_URL}    ${BASE_URL}/#/cpm/organizationHierarchy
${TC_USERNAME}               %{TC_USERNAME}
${TC_PASSWORD}               %{TC_PASSWORD}
${TIMEOUT}                   30s

*** Test Cases ***
Customer Hierarchy Displays Info And Audit Tabs
    [Documentation]    Verify the Customer Hierarchy page loads and displays both Info and Audit tabs
    [Tags]    Hierarchy    UI    automation    TC-AIR-008    navigation    customer-hierarchy    tabs
    [Setup]    Open Test Session
    [Teardown]    Close Test Session

    Login To Application
    Navigate To Customer Hierarchy Page
    Verify Info Tab Is Visible
    Verify Audit Tab Is Visible

*** Keywords ***
Navigate To Customer Hierarchy Page
    Go To    ${CUSTOMER_HIERARCHY_URL}
    Wait Until Keyword Succeeds    ${TIMEOUT}    1s    URL Should Contain    organizationHierarchy
    Wait For Elements State    text=Info    visible    ${TIMEOUT}

Verify Info Tab Is Visible
    Wait For Elements State    text=Info    visible    ${TIMEOUT}
    ${count}=    Get Element Count    text=Info
    Should Be True    ${count} >= 1    Expected Info tab to be present on Customer Hierarchy page

Verify Audit Tab Is Visible
    Wait For Elements State    text=Audit    visible    ${TIMEOUT}
    ${count}=    Get Element Count    text=Audit
    Should Be True    ${count} >= 1    Expected Audit tab to be present on Customer Hierarchy page

URL Should Contain
    [Arguments]    ${expected}
    ${url}=    Get Url
    Should Contain    ${url}    ${expected}
