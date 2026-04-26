from setuptools import find_packages, setup

setup(
    name="anvil-lint",
    version="0.1.0",
    packages=find_packages(),
    entry_points={
        "flake8.extension": [
            "ANV = anvil_lint:AnvilChecker",
        ],
    },
    install_requires=["flake8>=6.0"],
    python_requires=">=3.11",
)
