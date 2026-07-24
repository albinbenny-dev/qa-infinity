*** Settings ***
Library       Browser
Library       DateTime
Resource      resources/Common.robot
Resource      resources/LoginPage.robot
Resource      resources/POSSalesPage.robot

Test Setup       Open Test Session
Test Teardown    Close Test Session


*** Test Cases ***
TC_23 Create EVD Bulk Order with duplicate MSISDN in file
    [Documentation]    Validates that uploading a CSV with duplicate MSISDN entries displays
    ...    the correct error message "File has duplicate records" without processing the order.
    [Tags]    POS_Sales    EVD    Bulk    Negative    Regression

    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to POS Sales
    Navigate to POS Sales EVD
    Select Bulk ERCV
    Upload EVD Bulk File    ${FilePath_POS_Bulk_Duplicate_MSISDN}
    Choose Payment Method And Recharge    TC01    TD01    Cash    ForPOSEVD    NA    Duplicate MSISDN
