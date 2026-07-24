*** Settings ***
Resource      ${CURDIR}/Airtel_PageObjects.robot
Resource      ${CURDIR}/Airtel_TestData.robot
Library       Browser
Library       Collections
Library       String
Resource      ../resources/Read_TestData.robot
Resource      ../resources/Common.robot


*** Variables ***
${Airtel_Testdata}    ${EMPTY}
${TIMEOUT}            60s


*** Keywords ***

Login to Airtel UI
    [Documentation]
    ...    Performs Keycloak two-step login (username page → password page).
    ...    caseID / dataID map to the Login sheet in the Excel test data workbook.
    [Arguments]    ${caseID}    ${dataID}    ${Action}=Yes
    ${data}=        Fetch From Excel    ${Airtel_Testdata}    Login    ${caseID}    ${dataID}
    ${username}=    getdata    ${data}    Username
    ${password}=    getData    ${data}    Password

    # Step 1 — enter username and advance to password screen
    Wait For Elements State    ${LoginPage}[UserName]    visible    ${TIMEOUT}
    Fill Text    ${LoginPage}[UserName]    ${username}
    Click    ${LoginPage}[LoginButton]

    # Step 2 — password field appears on next screen
    Wait For Elements State    ${LoginPage}[Password]    visible    ${TIMEOUT}
    Fill Text    ${LoginPage}[Password]    ${password}
    Scroll To Element    xpath=//*[@id="kc-info"]
    Click    ${LoginPage}[LoginButton]
    Sleep    2s

    # Handle "active session" warning dialog if it appears
    IF    '${Action}' == 'Yes'
        ${send_anyway_visible}=    Run Keyword And Return Status
        ...    Wait For Elements State    ${LoginPage}[SendAnywayBtn]    visible    8s
        IF    ${send_anyway_visible}
            Click    ${LoginPage}[SendAnywayBtn]
            Sleep    5s
        END
    END
    Take Screenshot
