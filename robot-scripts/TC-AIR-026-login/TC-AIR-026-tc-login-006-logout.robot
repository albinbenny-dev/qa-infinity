*** Settings ***
Documentation       TC_LOGIN_006 - Logout From Application
...                 Verify that after login the user can log out successfully.
Library             Browser    auto_closing_level=KEEP

*** Variables ***
${BASE_URL}          https://airtel6d-in-ventas-master-int-aavm-alpha-01.ocplab.6d.local
${TC_USERNAME}       Nigeria2
${TC_PASSWORD}       pass@6Dtech
${USERNAME_FIELD}    css=#username
${PASSWORD_FIELD}    css=#password
${LOGIN_BTN}         css=#kc-login
${TIMEOUT}           30s

*** Test Cases ***

TC_LOGIN_006 - Logout From Application
    [Documentation]    Verify that after login the user can log out successfully.
    [Tags]             smoke    logout    regression
    [Setup]            Open Airtel Application
    [Teardown]         Close Test Session
    Enter Username And Proceed    ${TC_USERNAME}
    Enter Password And Submit     ${TC_PASSWORD}
    Verify Successful Login
    Logout From Application
    ${src}=    Get Page Source
    Should Contain    ${src}    Welcome to USDM 2.0

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

Enter Password And Submit
    [Arguments]    ${password}
    Fill Text    ${PASSWORD_FIELD}    ${password}
    Wait For Elements State    ${LOGIN_BTN}    enabled    ${TIMEOUT}
    Click        ${LOGIN_BTN}
    Sleep        3s

Verify Successful Login
    Wait Until Keyword Succeeds    ${TIMEOUT}    1s    URL Should Contain    myProfile

URL Should Contain
    [Arguments]    ${expected}
    ${url}=    Get Url
    Should Contain    ${url}    ${expected}

Logout From Application
    Click    css=.user-avatar-btn
    Sleep    1s
    Click    text=Logout
    Wait For Elements State    ${USERNAME_FIELD}    visible    ${TIMEOUT}
