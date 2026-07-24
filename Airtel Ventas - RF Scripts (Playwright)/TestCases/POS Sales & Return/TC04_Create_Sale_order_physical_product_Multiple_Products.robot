*** Settings ***
Library       Browser
Library       DateTime
Resource      resources/Common.robot
Resource      resources/LoginPage.robot
Resource      resources/POSSalesPage.robot

Test Setup       Open Test Session
Test Teardown    Close Test Session


*** Test Cases ***
TC_04 Create a Sale order of Physical product with multiple products
    [Documentation]    Validate POS Sale order with two serial numbers scanned into the cart,
    ...    including removing a third scanned asset before submitting.
    [Tags]    POS_Sales    Physical_Product    Multiple_Products    Regression

    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to cash register Menu
    Store Asset from Stock View Screen    TC01    TD01    Yes
    Navigate to POS Sales
    Navigate to POS Sales Sub Menu
    Search the Existing Customer    Yes
    Validate the Name and Number of the Existing Customer
    Enter the serial number and scan    2    NA    Two Serial Numbers
    Verify the Payment Options
    Choose Payment Method And Submit    TC01    TD01    Cash    NA    Yes
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
