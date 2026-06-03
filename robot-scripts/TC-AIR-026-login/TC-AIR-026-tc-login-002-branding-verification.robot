*** Settings ***
Documentation       TC_LOGIN_002 - Login Page Branding And Content Verification
...                 Verify the login page displays correct headings and branding.
Library             Browser    auto_closing_level=KEEP

*** Variables ***
${BASE_URL}          https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local
${USERNAME_FIELD}    css=#username
${TIMEOUT}           30s

*** Test Cases ***

TC_LOGIN_002 - Login Page Branding And Content Verification
    [Documentation]    Verify the login page displays correct headings and branding.
    [Tags]             smoke    ui    branding
    [Setup]            Open Airtel Application
    [Teardown]         Close Test Session
    ${src}=    Get Page Source
    Should Contain    ${src}    Welcome to USDM 2.0
    Should Contain    ${src}    Sign In and stay connected
    Should Contain    ${src}    Or sign in with
    Should Contain    ${src}    Airtel SSO Login

*** Keywords ***

Open Airtel Application
    New Browser    chromium    headless=False
    New Context    ignoreHTTPSErrors=True
    New Page       ${BASE_URL}
    Wait For Elements State    ${USERNAME_FIELD}    visible    ${TIMEOUT}

Close Test Session
    Close Browser
