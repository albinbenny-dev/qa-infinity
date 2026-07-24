*** Settings ***
Library       Browser
Library       DateTime
Resource      resources/Common.robot
Resource      resources/LoginPage.robot
Resource      resources/POSSalesPage.robot

Test Setup       Open Test Session
Test Teardown    Close Test Session


*** Test Cases ***
TC_22 Create EVD Bulk Order with proper file
    [Documentation]    Validates that uploading a correctly formatted CSV bulk EVD file
    ...    creates all recharge orders successfully with COMPLETED status.
    [Tags]    POS_Sales    EVD    Bulk    Regression

    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to POS Sales
    Navigate to POS Sales EVD
    Select Bulk ERCV
    Upload EVD Bulk File    ${FilePath_POS_Bulk}
    Choose Payment Method And Recharge    TC01    TD01    Cash    ForPOSEVD    NA    NA
    Verify the status of Suborders    POS EVD
