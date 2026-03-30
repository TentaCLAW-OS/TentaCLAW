"""Setup script for TentaCLAW Python SDK."""

from setuptools import setup, find_packages
from pathlib import Path

this_directory = Path(__file__).parent
long_description = (this_directory / "README.md").read_text(encoding="utf-8")

setup(
    name="tentaclaw",
    version="0.1.0",
    author="TentaCLAW OS",
    author_email="sdk@tentaclaw.io",
    description="Python SDK for TentaCLAW OS — GPU inference cluster management",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/TentaCLAW-OS/sdk-python",
    project_urls={
        "Documentation": "https://tentaclaw.io/docs/sdk/python",
        "Bug Tracker": "https://github.com/TentaCLAW-OS/sdk-python/issues",
        "Source Code": "https://github.com/TentaCLAW-OS/sdk-python",
    },
    packages=find_packages(),
    package_data={"tentaclaw": ["py.typed"]},
    python_requires=">=3.9",
    install_requires=[
        "requests>=2.28.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0",
            "pytest-cov>=4.0",
            "responses>=0.23.0",
            "mypy>=1.0",
            "ruff>=0.1.0",
        ],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Intended Audience :: Science/Research",
        "License :: OSI Approved :: Apache Software License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
        "Topic :: System :: Clustering",
        "Typing :: Typed",
    ],
    keywords="gpu inference cluster llm ai ml tentaclaw ollama",
)
