"""
Convert Airtel_PageObjects.yaml and Airtel_TestData.yaml into uploadable
Robot Framework resource files (.robot) with &{DICT} variable definitions.

Access syntax stays identical:  ${LoginPage}[UserName]  ${POSSalesDetails}[CreateOrder]

Run:
    python convert_yaml_to_robot.py

Outputs:
    resources/Airtel_PageObjects.robot
    resources/Airtel_TestData.robot
"""

import yaml
import os
import re

YAML_DIR  = os.path.join(os.path.dirname(__file__), "PageObjects")
OUT_DIR   = os.path.join(os.path.dirname(__file__), "resources")

os.makedirs(OUT_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sanitize_comment(name: str) -> str:
    return f"# {name}"


def write_dict_var(lines: list, var_name: str, kvpairs: dict):
    """Write a &{var_name} block with key=value pairs (all string values)."""
    if not kvpairs:
        return
    lines.append(f"&{{{var_name}}}")
    items = list(kvpairs.items())
    for i, (k, v) in enumerate(items):
        # Escape backslashes first
        v_escaped = str(v).replace("\\", "\\\\")
        # Remove newlines / carriage returns from multi-line YAML values
        v_escaped = v_escaped.replace("\r", "").replace("\n", " ")
        # RF dict parser uses 2+ consecutive spaces as an item separator.
        # Replace any run of 2+ spaces in the value with a single space so
        # the locator is kept on one logical token.
        import re as _re
        v_escaped = _re.sub(r' {2,}', ' ', v_escaped)
        if i < len(items) - 1:
            lines.append(f"...    {k}={v_escaped}")
        else:
            lines.append(f"...    {k}={v_escaped}")
    lines.append("")


def flatten_to_robot_vars(node, prefix="", result=None):
    """
    Walk the nested YAML dict and produce a flat list of
    (variable_name, {key: locator, ...}) tuples.

    Rules:
    - A dict whose values are ALL strings  →  one &{VarName} block
    - A dict with nested dicts             →  recurse, extracting leaf dicts
    - The top-level key (AIRTEL) is skipped; its children become the page dicts
    """
    if result is None:
        result = []

    for key, value in node.items():
        if not isinstance(value, dict):
            continue  # skip plain scalar children at this level

        # Check if all leaf values are strings (i.e. this is a locator dict)
        leaf_kv = {k: v for k, v in value.items() if isinstance(v, str)}
        nested   = {k: v for k, v in value.items() if isinstance(v, dict)}

        if leaf_kv:
            var_name = key  # e.g. LoginPage, POSSalesDetails
            result.append((var_name, leaf_kv))

        if nested:
            flatten_to_robot_vars(nested, prefix=key, result=result)

    return result


# ---------------------------------------------------------------------------
# Convert PageObjects YAML
# ---------------------------------------------------------------------------

def convert_page_objects():
    src = os.path.join(YAML_DIR, "Airtel_PageObjects.yaml")
    dst = os.path.join(OUT_DIR,  "Airtel_PageObjects.robot")

    with open(src, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    # Top-level key is AIRTEL; navigate into it
    airtel = data.get("AIRTEL", data)

    lines = [
        "*** Variables ***",
        "# ============================================================",
        "# Airtel Ventas Page Object Locators",
        "# Auto-generated from Airtel_PageObjects.yaml",
        "# Upload this file as a resource through the QA Infinity frontend.",
        "# Access pattern unchanged:  ${PageName}[LocatorKey]",
        "# ============================================================",
        "",
    ]

    # Collect all page-level and sub-page-level dicts
    page_vars = flatten_to_robot_vars(airtel)

    for var_name, kv in page_vars:
        lines.append(sanitize_comment(var_name))
        write_dict_var(lines, var_name, kv)

    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Generated: {dst}  ({len(page_vars)} dict variables)")


# ---------------------------------------------------------------------------
# Convert TestData YAML
# ---------------------------------------------------------------------------

def convert_test_data():
    src = os.path.join(YAML_DIR, "Airtel_TestData.yaml")
    dst = os.path.join(OUT_DIR,  "Airtel_TestData.robot")

    with open(src, encoding="utf-8") as f:
        data = yaml.safe_load(f)

    td = data.get("TestData", data)

    lines = [
        "*** Variables ***",
        "# ============================================================",
        "# Airtel Ventas Test Data Configuration",
        "# Auto-generated from Airtel_TestData.yaml",
        "# Upload this file as a resource through the QA Infinity frontend.",
        "# ============================================================",
        "",
    ]

    # Separate scalar values from nested dicts
    scalars = {}
    nested_dicts = {}

    for k, v in td.items():
        if isinstance(v, dict):
            nested_dicts[k] = v
        else:
            scalars[k] = v

    # Write top-level scalar variables
    if scalars:
        lines.append("# Top-level settings")
        for k, v in scalars.items():
            safe_v = str(v) if v is not None else ""
            lines.append(f"${{{k}}}    {safe_v}")
        lines.append("")

        # Also expose as a combined &{TestData} dict for backward compatibility
        lines.append("# Combined &{TestData} dict — access: ${TestData}[URL], ${TestData}[Browser] etc.")
        write_dict_var(lines, "TestData", {k: (str(v) if v is not None else "") for k, v in scalars.items()})

    # Write nested dicts (e.g. POS_EVD, StockTransfer, PaymentManagement)
    for section_name, section_data in nested_dicts.items():
        if isinstance(section_data, dict):
            lines.append(sanitize_comment(f"TestData[{section_name}]"))
            flat = {k: (str(v) if v is not None else "") for k, v in section_data.items() if not isinstance(v, dict)}
            if flat:
                write_dict_var(lines, section_name, flat)

    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"Generated: {dst}")


# ---------------------------------------------------------------------------
# Patch resource files — replace Variables imports with Resource imports
# ---------------------------------------------------------------------------

RESOURCE_FILES = [
    "Common.robot",
    "LoginPage.robot",
    "POSSalesPage.robot",
]

OLD_VARS = [
    "Variables     ${CURDIR}/../PageObjects/Airtel_PageObjects.yaml",
    "Variables     ${CURDIR}/../PageObjects/Airtel_TestData.yaml",
    "Variables     ../PageObjects/Airtel_PageObjects.yaml",
    "Variables     ../PageObjects/Airtel_TestData.yaml",
]

NEW_RESOURCES = (
    "Resource      ${CURDIR}/Airtel_PageObjects.robot\n"
    "Resource      ${CURDIR}/Airtel_TestData.robot"
)


def patch_resource_files():
    for fname in RESOURCE_FILES:
        fpath = os.path.join(OUT_DIR, fname)
        if not os.path.exists(fpath):
            print(f"  SKIP (not found): {fpath}")
            continue

        with open(fpath, encoding="utf-8") as f:
            content = f.read()

        original = content

        # Remove old Variables lines (either variant)
        for old_line in OLD_VARS:
            content = content.replace(old_line + "\n", "")
            content = content.replace(old_line, "")

        # Insert new Resource lines right after *** Settings *** block opener
        if "Resource      ${CURDIR}/Airtel_PageObjects.robot" not in content:
            content = content.replace(
                "*** Settings ***\n",
                f"*** Settings ***\n{NEW_RESOURCES}\n",
                1
            )

        if content != original:
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  Patched: {fname}")
        else:
            print(f"  Already up to date: {fname}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=== Converting YAML -> Robot Framework resource files ===\n")
    convert_page_objects()
    convert_test_data()
    print("\n=== Patching Variable imports in resource files ===")
    patch_resource_files()
    print("\nDone. Upload these two files via QA Infinity frontend (Scripts > Upload):")
    print(f"  {os.path.join(OUT_DIR, 'Airtel_PageObjects.robot')}")
    print(f"  {os.path.join(OUT_DIR, 'Airtel_TestData.robot')}")
