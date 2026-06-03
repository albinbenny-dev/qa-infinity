*** Settings ***
Documentation       TC_LOGIN_004 - Password Field Is Masked
...                 Verify the password input is of type password.
Library             Browser    auto_closing_level=KEEP

*** Variables ***
${BASE_URL}          https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local
${TC_USERNAME}       Nigeria2
${USERNAME_FIELD}    css=#username
${PASSWORD_FIELD}    css=#password
${LOGIN_BTN}         css=#kc-login
${TIMEOUT}           30s

*** Test Cases ***

TC_LOGIN_004 - Password Field Is Masked
    [Documentation]    Verify the password input is of type password.
    [Tags]             security    login
    [Setup]            Open Airtel Application
    [Teardown]         Close Test Session
    Enter Username And Proceed    ${TC_USERNAME}
    Wait For Elements State    ${PASSWORD_FIELD}    visible    ${TIMEOUT}
    ${field_type}=    Get Attribute    ${PASSWORD_FIELD}    type
    Should Be Equal As Strings    ${field_type}    password

*** Keywords ***

Open Airtel Application
    New Browser    chromium    headless=False
    New Context    ignoreHTTPSErrors=True
    New Page       ${BASE_URL}
    Wait For Elements State    ${USERNAME_FIELD}    visible    ${TIMEOUT}

Close Test Session
    Close Browser

Enter Username And Proceed
    [Arguments]    ${username}
    Fill Text    ${USERNAME_FIELD}    ${username}
    Click        ${LOGIN_BTN}
    Wait For Elements State    ${PASSWORD_FIELD}    visible    ${TIMEOUT}
