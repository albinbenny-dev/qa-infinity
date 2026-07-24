*** Settings ***
Library       Browser
Library       DateTime
Resource      resources/Common.robot
Resource      resources/LoginPage.robot
Resource      resources/POSSalesPage.robot

Test Setup       Open Test Session
Test Teardown    Close Test Session


*** Test Cases ***
TC_17 Create a Sale order of virtual product EVD with New customer
    [Documentation]    Validate POS EVD (Electronic Virtual Delivery) sale for a new customer:
    ...    verify cash register balance before and after, enter MSISDN + recharge amount,
    ...    pay by cash, and confirm the order with invoice generated.
    [Tags]    POS_Sales    EVD    New_Customer    Regression

    Login to Airtel UI    Airtel_Cashier_Login    Airtel_Cashier_TD_Login
    Navigate to cash register Menu
    Verify Cash and Balance for POS EVD    TC01    TD01
    Navigate to POS Sales
    Navigate to POS Sales EVD
    Navigate to New Customer Details Page    POSSalesEVD
    Enter the Details for New Customer and Create    TC01    TD01    POS EVD    EVD
    Enter the Details in ERCV/Pretups Sales    TC01    TD01
    Verify the Payment Options
    Choose Payment Method And Recharge    TC01    TD01    Cash    ForPOSEVD
    Reload

    Navigate to POS Sales
    Navigate to POS Sales EVD
    Search the created Sale Order for POS EVD
    Verify the created Sale Order    POS EVD
    Verify the status of Suborders    POS EVD

    Navigate to cash register Menu
    Verify Cash and Balance for POS EVD    TC01    TD01    After POS EVD
