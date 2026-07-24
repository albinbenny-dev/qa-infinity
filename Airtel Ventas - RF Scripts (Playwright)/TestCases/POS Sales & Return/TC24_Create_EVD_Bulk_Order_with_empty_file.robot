*** Settings ***
Library       Browser
Library       DateTime
Resource      resources/Common.robot
Resource      resources/LoginPage.robot
Resource      resources/POSSalesPage.robot

Test Setup       Open Test Session
Test Teardown    Close Test Session


*** Test Cases ***
TC_24 Create EVD Bulk Order with empty file
    [Documentation]    Validates that uploading an empty CSV file shows the error message
    ...    "Transfer amount provided is not matching with amount from file".
    [Tags]    POS_Sales    EVD    Bulk    Negative    Regression

    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to POS Sales
    Navigate to POS Sales EVD
    Select Bulk ERCV
    Upload EVD Bulk File    ${FilePath_POS_Bulk_Empty_File}
    Choose Payment Method And Recharge    TC01    TD01    Cash    ForPOSEVD    NA    EmptyFile
