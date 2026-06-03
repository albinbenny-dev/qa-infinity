*** Settings ***
Documentation       TC_LOGIN_005 - SSO Login Link Is Present On Login Page
...                 Verify Airtel SSO Login link is visible on the login page.
Library             Browser    auto_closing_level=KEEP

*** Variables ***
${BASE_URL}          https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local
${USERNAME_FIELD}    css=#username
${TIMEOUT}           30s

*** Test Cases ***

TC_LOGIN_005 - SSO Login Link Is Present On Login Page
    [Documentation]    Verify Airtel SSO Login link is visible on the login page.
    [Tags]             ui    login    sso
    [Setup]            Open Airtel Application
    [Teardown]         Close Test Session
    Wait For Elements State    text=Airtel SSO Login    visible    ${TIMEOUT}

*** Keywords ***

Open Airtel Application
    New Browser    chromium    headless=False
    New Context    ignoreHTTPSErrors=True
    New Page       ${BASE_URL}
    Wait For Elements State    ${USERNAME_FIELD}    visible    ${TIMEOUT}

Close Test Session
    Close Browser
