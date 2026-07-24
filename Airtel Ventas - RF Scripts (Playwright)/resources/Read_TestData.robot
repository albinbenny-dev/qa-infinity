*** Settings ***
Library    Collections
Library    OperatingSystem


*** Keywords ***

Fetch From Excel
    [Documentation]
    ...    QA Infinity runner replacement for Excel-based data reading.
    ...    - Login data  → read from env vars VENTAS_USERNAME / VENTAS_PASSWORD
    ...    - Module data → read from RF dict variable &{<Sheet>_<CaseID>_<DataID>}
    ...      defined in the module TestData resource file (e.g. POSSalesTestData.robot).
    [Arguments]    ${filename}    ${sheet}    ${caseID}    ${dataID}
    IF    '${sheet}' == 'Login'
        # ${TC_USERNAME} and ${TC_PASSWORD} are injected by the QA Infinity runner
        # from the project credentials configured in project settings.
        ${data}=    Create Dictionary    Username=${TC_USERNAME}    Password=${TC_PASSWORD}
        RETURN    ${data}
    END
    ${varname}=    Catenate    SEPARATOR=_    ${sheet}    ${caseID}    ${dataID}
    ${data}=    Get Variable Value    ${${varname}}    ${NONE}
    IF    $data is None
        Fail
        ...    Test data not found: &{${varname}}\n
        ...    Define this dict in a TestData resource file and upload via QA Infinity frontend.
    END
    RETURN    ${data}

getdata
    [Documentation]    Extract a single field value from a data dict. Case-insensitive alias: getData.
    [Arguments]    ${data}    ${tag}
    ${value}=    Get From Dictionary    ${data}    ${tag}    default=${EMPTY}
    RETURN    ${value}

Read Number of Rows
    [Arguments]    ${filename}    ${sheetname}
    RETURN    1

Fetch count entries
    [Arguments]    ${filename}    ${sheetname}    ${TestCaseID}
    RETURN    1

Read Excel Data of cell
    [Arguments]    ${filename}    ${sheetname}    ${row}    ${cell}
    RETURN    ${EMPTY}

Fetch Row Data
    [Arguments]    ${filename}    ${sheetname}    ${row}
    RETURN    ${EMPTY}
