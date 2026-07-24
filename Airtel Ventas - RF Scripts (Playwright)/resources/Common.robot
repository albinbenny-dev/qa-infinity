*** Settings ***
Resource      ${CURDIR}/Airtel_PageObjects.robot
Resource      ${CURDIR}/Airtel_TestData.robot
Library       OperatingSystem
Library       Browser
Library       Collections
Library       String
Library       DateTime
Resource      ../resources/Read_TestData.robot


*** Variables ***
${Airtel_Testdata}    ${EMPTY}
${TIMEOUT}            60s
${interval}           1s


*** Keywords ***

# ---------------------------------------------------------------------------
# Browser session lifecycle
# ---------------------------------------------------------------------------

Open Test Session
    [Documentation]    Opens Chromium browser, creates context and navigates to app URL.
    ...    URL is read from the VENTAS_URL environment variable (set in QA Infinity project settings).
    New Browser    chromium    headless=False
    New Context    ignoreHTTPSErrors=True    recordVideo={"dir": "${OUTPUT DIR}/videos"}
    New Page       ${BASE_URL}

Close Test Session
    [Documentation]    Captures final screenshot then closes browser.
    Take Screenshot
    Close Browser

Execute Suite Setup as User
    [Documentation]    Alias kept for backward compatibility.
    Open Test Session

Execute Suite Teardown
    [Documentation]    Alias kept for backward compatibility.
    Close Test Session

Execute Suite Teardown Without Exit
    [Documentation]    Teardown with server-error detection before closing.
    [Arguments]    ${caseID}    ${dataID}
    ${server_error}=    Run Keyword And Return Status
    ...    Wait For Elements State    xpath=//span[text()="Unable to process request Inernal Server Error"]    visible    5s
    IF    ${server_error}
        Take Screenshot
        Fail    Unable to process request - Internal Server Error
    END
    Take Screenshot
    Close Browser


# ---------------------------------------------------------------------------
# Element state helpers
# ---------------------------------------------------------------------------

Verify element is visible and displayed
    [Documentation]    Waits until element is visible, stable and attached.
    [Arguments]    ${locator}
    ${status}=    Run Keyword And Return Status
    ...    Wait For Elements State    ${locator}    visible    60s
    IF    not ${status}
        Take Screenshot
        Fail    Error: Expected locator not visible\n\n(Locator: '${locator}')
    END

Verify Popup is visible and displayed
    [Documentation]    Waits for a popup element; includes message extraction for error context.
    [Arguments]    ${locator}
    ${status}=    Run Keyword And Return Status
    ...    Wait For Elements State    ${locator}    visible    40s
    IF    not ${status}
        Take Screenshot
        Fail    Expected popup not found\n\n(Locator: '${locator}')
    END

Element Should Not Be Visible Check
    [Arguments]    ${locator}
    Wait For Elements State    ${locator}    hidden    10s


# ---------------------------------------------------------------------------
# Click helpers
# ---------------------------------------------------------------------------

Click The Element
    [Arguments]    ${locator}
    Verify element is visible and displayed    ${locator}
    Click    ${locator}

Click Item
    [Arguments]    ${locator}
    ${status}=    Run Keyword And Return Status    Click The Element    ${locator}
    IF    not ${status}
        Take Screenshot
        Fail    The specified option is not present or not clickable.\n\n(Locator: '${locator}')
    END

Manage tab
    [Arguments]    ${tab_locator}
    Wait For Elements State    ${tab_locator}    visible    ${TIMEOUT}
    Click    ${tab_locator}


# ---------------------------------------------------------------------------
# Input helpers
# ---------------------------------------------------------------------------

Set Input
    [Arguments]    ${locator}    ${value}
    Verify element is visible and displayed    ${locator}
    IF    '${value}' == 'BLANK' or '${value}' == 'nan'
        Fill Text    ${locator}    ${EMPTY}
    ELSE
        Fill Text    ${locator}    ${value}
    END

Input the text
    [Arguments]    ${locator}    ${value}
    Verify element is visible and displayed    ${locator}
    Fill Text    ${locator}    ${value}

Enter the value
    [Arguments]    ${locator}    ${value}
    ${status}=    Run Keyword And Return Status    Input the text    ${locator}    ${value}
    IF    not ${status}
        Take Screenshot
        Fail    The specified input field is not interactable.\n\n(Locator: '${locator}')
    END

Input Text Verification
    [Arguments]    ${locator}    ${value}
    ${status}=    Run Keyword And Return Status    Fill Text    ${locator}    ${value}
    IF    not ${status}
        Take Screenshot
        Fail    Error: Unable to locate input field\n\n(Locator: '${locator}')
    END


# ---------------------------------------------------------------------------
# Dropdown helpers
# ---------------------------------------------------------------------------

Set Dropdown
    [Documentation]    Clicks dropdown then selects option by visible text (radio-style custom dropdown).
    [Arguments]    ${dropdown}    ${locator_label}
    Click Item    ${dropdown}
    ${option}=    Set Variable    xpath=//label[text()='${locator_label}' and @md='10']
    ${visible}=    Run Keyword And Return Status
    ...    Wait For Elements State    ${option}    visible    5s
    IF    not ${visible}
        Take Screenshot
        Fail    Error: Dropdown option '${locator_label}' not found in list
    END
    Click Item    ${option}

Set Dropdown smart
    [Documentation]    Clicks dropdown then selects option rendered as a div (React select-style).
    [Arguments]    ${dropdown}    ${locator_label}
    Click Item    ${dropdown}
    ${option}=    Set Variable    xpath=//div[text()='${locator_label}']
    ${visible}=    Run Keyword And Return Status
    ...    Wait For Elements State    ${option}    visible    5s
    IF    not ${visible}
        Take Screenshot
        Fail    Error: Dropdown option '${locator_label}' not found in list
    END
    Click Item    ${option}

Set Dropdown2
    [Arguments]    ${dropdown}    ${locator_li}
    Click Item    ${dropdown}
    Click Item    xpath=//li[text()='${locator_li}']

Set Dropdown3
    [Arguments]    ${dropdown}    ${locator_label}
    Click Item    ${dropdown}
    Click Item    xpath=//div[text()='${locator_label}']

Set dropdown4
    [Arguments]    ${dropdown}    ${Year}
    Click Item    ${dropdown}
    Click Item    xpath=//option[text()='${Year}']

Set Dropdown5
    [Arguments]    ${dropdown}    ${locator_label}
    Click Item    ${dropdown}
    Click Item    xpath=//label[text()='${locator_label}']

Set Dropdown6
    [Arguments]    ${dropdown}    ${locator_li}
    Click Item    ${dropdown}
    Click Item    xpath=//li[text()='${locator_li}']

Set Records Per Page
    [Arguments]    ${locator_Option}
    Click Item    xpath=//select[@class='form-control']
    Click Item    xpath=//Option[text()='${locator_Option}']


# ---------------------------------------------------------------------------
# Date / time / slider helpers
# ---------------------------------------------------------------------------

Set Month
    [Arguments]    ${Locator}    ${dropdown}    ${Month}
    Click Item    ${Locator}
    Set dropdown4    ${dropdown}    ${Month}

Set Year
    [Arguments]    ${Locator}    ${Year}    ${dropdown}
    Click Item    ${Locator}
    Set dropdown4    ${dropdown}    ${Year}

Set Date
    [Arguments]    ${Locator}    ${Date}
    Click Item    ${Locator}
    Click Item    xpath=//div[@aria-label='${Date}']

Start Time
    [Arguments]    ${Locator}    ${StartTime}
    Click Item    ${Locator}
    Click Item    xpath=//li[normalize-space()='${StartTime}']

Set Slider
    [Arguments]    ${label}    ${value}
    ${checked}=    Run Keyword And Return Status
    ...    Wait For Elements State
    ...    xpath=//label[text()='${label}']/following-sibling::div/label//span/input[@type='checkbox']
    ...    checked    5s
    ${current}=    Set Variable If    ${checked}    YES    NO
    IF    '${value}' != '${current}' and '${value}' != 'nan'
        Click Item    xpath=//label[text()='${label}']/following-sibling::div/label//div
    END

Set Radio Button
    [Arguments]    ${label}    ${value}
    Click Item    xpath=//span[text()='${label}']/preceding-sibling::span//input


# ---------------------------------------------------------------------------
# Scroll helpers
# ---------------------------------------------------------------------------

Scroll Page Horizontally
    Evaluate JavaScript    document    () => window.scrollTo(500, 0)

Scroll Page Vertically
    Evaluate JavaScript    document    () => window.scrollTo(0, 500)

Scroll Page Vertically to desired position
    [Arguments]    ${position}
    Evaluate JavaScript    document    () => window.scrollTo(0, ${position})

Scroll Page Vertically up
    Evaluate JavaScript    document    () => window.scrollTo(500, 0)

Scroll Element Verification
    [Arguments]    ${locator}
    ${status}=    Run Keyword And Return Status    Scroll To Element    ${locator}
    IF    not ${status}
        Fail    ERROR: Locator not found for scroll\n\n(Locator: '${locator}')
    END


# ---------------------------------------------------------------------------
# File operations
# ---------------------------------------------------------------------------

File Upload
    [Arguments]    ${locator}    ${FilePath}
    Scroll To Element    ${locator}
    Sleep    4s
    Upload File By Selector    ${locator}    ${FilePath}

Download should be done
    [Documentation]    Verifies a single file was downloaded to directory (not a temp file).
    [Arguments]    ${directory}    ${regexp}=${EMPTY}    ${downloadInd}=${True}
    Sleep    5s
    ${file}=    Set Variable    ${EMPTY}
    IF    ${downloadInd}
        ${files}=    List Files In Directory    ${directory}
        Length Should Be    ${files}    1    Should be only one file in the download folder
        Sleep    5s
        IF    '${regexp}' != '${EMPTY}'
            Should Match Regexp    ${files[0]}    ${regexp}    File matching with regex pattern
        END
        ${file}=    Join Path    ${directory}    ${files[0]}
        Log    File was successfully downloaded to ${file}
    END
    RETURN    ${file}

Rename Downloaded Tmp File To Required Format
    [Arguments]    ${download_directory}
    ${files}=    List Files In Directory    ${download_directory}
    Length Should Be    ${files}    1    Only one file should exist to rename
    ${filename}=    Set Variable    ${files[0]}
    ${filepath}=    Join Path    ${download_directory}    ${filename}
    ${should_rename}=    Evaluate    "${filename}".endswith(".crdownload") or "${filename}".endswith(".tmp")
    IF    ${should_rename}
        ${renamed}=    Evaluate    "${filepath}".rsplit('.', 1)[0]
        Move File    ${filepath}    ${renamed}
        ${filepath}=    Set Variable    ${renamed}
    END
    RETURN    ${filepath}

Modify CSV Column
    [Arguments]    ${CSVfilePath}    ${Filename}    ${ColumnName}    ${row_index}    ${Value}
    ${row_index}=    Evaluate    int(${row_index})
    modify_csv_cell    ${CSVfilePath}    ${Filename}    ${ColumnName}    ${row_index}    ${Value}

Modify Excel Column
    [Arguments]    ${ExcelFilePath}    ${Filename}    ${ColumnName}    ${row_index}
    ${random_string1}=    Generate Random String    5    0123456789
    ${PONumber_generated}=    Catenate    SEPARATOR=    POA800    ${random_string1}
    ${row_index}=    Evaluate    int(${row_index})
    modify_excel_cell    ${ExcelFilePath}    ${Filename}    ${ColumnName}    ${row_index}    ${PONumber_generated}


# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------

Should Be Equal Verification
    [Arguments]    ${actual_value}    ${expected_value}
    IF    '${actual_value}' != '${expected_value}'
        Take Screenshot
        Fail    Values do not match.\nExpected: ${expected_value}\nActual: ${actual_value}
    END
    Should Be Equal    ${actual_value}    ${expected_value}

Should Not Be Equal Verification
    [Arguments]    ${receivedValue}    ${expected_value}
    IF    '${receivedValue}' == '${expected_value}'
        Take Screenshot
        Fail    Error: Unexpected matching value received: '${receivedValue}'
    END
    Should Not Be Equal    ${receivedValue}    ${expected_value}

Should Be Equal As Strings Verification
    [Arguments]    ${actual_value}    ${expected_value}
    IF    '${actual_value}' != '${expected_value}'
        Take Screenshot
        Fail    Values do not match.\nExpected: ${expected_value}\nActual: ${actual_value}
    END
    Should Be Equal As Strings    ${actual_value}    ${expected_value}

Should Be Equal As Numbers Verification
    [Arguments]    ${actual_value}    ${expected_value}
    ${ok}=    Run Keyword And Return Status    Should Be Equal As Numbers    ${actual_value}    ${expected_value}
    IF    not ${ok}
        Take Screenshot
        Fail    Values do not match.\nExpected: ${expected_value}\nActual: ${actual_value}
    END

Custom Error Message
    [Arguments]    ${message}
    Take Screenshot
    Fail    ${message}

Fail Test
    Fail    Test case failed


# ---------------------------------------------------------------------------
# Page helpers
# ---------------------------------------------------------------------------

Refresh Page
    Reload

Verify Page title
    Sleep    5s
    ${title}=    Get Title
    Should Be Equal    SIM for Things    ${title}

Capture Screenshot
    Take Screenshot

Logout as User
    [Documentation]    Logs out the current user and closes the browser.
    Verify element is visible and displayed    ${Logout}[LogoutSV]
    Click Item    ${Logout}[LogoutSV]
    Verify element is visible and displayed    ${Logout}[Logoutbtn]
    Click Item    ${Logout}[Logoutbtn]
    Sleep    2s
    Close Browser

Current Date
    [Arguments]    ${result_format}
    ${current_time}=    Get Current Date    result_format=${result_format}
    RETURN    ${current_time}

Generate Random 5 Digit Number
    ${number}=    Evaluate    random.randint(10000, 99999)    random
    RETURN    ${number}

Run Keyword If Previous Test Passed
    [Arguments]    ${keyword}    ${tc}    ${td}    ${screenshot_case_id}    ${screenshot_data_id}
    ${prev_ok}=    Run Keyword And Return Status    Should Be True    '${PREV TEST STATUS}' == 'PASS'
    IF    ${prev_ok}
        Run Keyword    ${keyword}    ${tc}    ${td}    ${screenshot_case_id}    ${screenshot_data_id}
    ELSE
        Fail    Error: Unable to proceed due to previous test case failure
    END
