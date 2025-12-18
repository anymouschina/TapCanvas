# mypy: disable - error - code = "no-untyped-def,misc"
import pathlib
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from agent.tools_and_schemas import PromptRequest, PromptResult
from agent.prompt_generator import generate_prompt
from fastapi.staticfiles import StaticFiles

# Define the FastAPI app
app = FastAPI()

# CORS for local dev + production web app.
# LangGraph SDK uses preflighted requests (e.g. POST /threads), so OPTIONS must succeed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://tapcanvas.beqlee.icu",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def create_frontend_router(build_dir="../frontend/dist"):
    """Creates a router to serve the React frontend.

    Args:
        build_dir: Path to the React build directory relative to this file.

    Returns:
        A Starlette application serving the frontend.
    """
    build_path = pathlib.Path(__file__).parent.parent.parent / build_dir

    if not build_path.is_dir() or not (build_path / "index.html").is_file():
        print(
            f"WARN: Frontend build directory not found or incomplete at {build_path}. Serving frontend will likely fail."
        )
        # Return a dummy router if build isn't ready
        from starlette.routing import Route

        async def dummy_frontend(request):
            return Response(
                "Frontend not built. Run 'npm run build' in the frontend directory.",
                media_type="text/plain",
                status_code=503,
            )

        return Route("/{path:path}", endpoint=dummy_frontend)

    return StaticFiles(directory=build_path, html=True)


# Mount the frontend under /app to not conflict with the LangGraph API routes
app.mount(
    "/app",
    create_frontend_router(),
    name="frontend",
)

@app.get("/")
def root():
    return {"ok": True}


@app.get("/ok")
def ok():
    return {"ok": True}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/prompt/generate", response_model=PromptResult)
def api_generate_prompt(payload: PromptRequest) -> PromptResult:
    """Generate a ready-to-use prompt (and negative prompt) for the given workflow."""
    return generate_prompt(payload)
