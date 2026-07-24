*** Settings ***
Library       Browser
Library       DateTime
Resource      resources/Common.robot
Resource      resources/LoginPage.robot
Resource      resources/POSSalesPage.robot

Test Setup       Open Test Session
Test Teardown    Close Test Session


*** Test Cases ***
TC_03 Create a Sale order of physical product with Partner
    [Documentation]    Validate POS Sale order creation selecting a partner (distributor)
    ...    as the buyer instead of an end customer.
    [Tags]    POS_Sales    Physical_Product    Partner    Regression

    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to cash register Menu
    Store Asset from Stock View Screen    TC01    TD01
    Navigate to POS Sales
    Navigate to POS Sales Sub Menu
    Search the Partner    TC01    TD01
    Validate the Name and Number of the Existing Customer
    Enter the serial number and scan
    Verify the Payment Options
    Choose Payment Method And Submit    TC01    TD01
    Sleep    15s
    Logout as User

    Open Test Session
    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to POS Sales
    Navigate to POS Sales Sub Menu
    Search the created Sale Order
    Verify the created Sale Order
    Verify the status of Suborders
    Navigate to cash register Menu
    Validation for Cash and Change value    TC01    TD01
